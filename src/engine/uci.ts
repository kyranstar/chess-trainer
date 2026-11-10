/** Minimal UCI client for the in-app engine. Transport-agnostic so it runs in a Web Worker or in Node tests. */
export interface EngineTransport {
  send(command: string): void;
  onLine(listener: (line: string) => void): void;
  terminate(): void;
}

export type Score = { cp: number } | { mate: number };
export interface PvLine {
  /** First move of the line, UCI. */
  move: string;
  /** Score from the side to move in the analysed position. */
  score: Score;
  pv: string[];
}

/** Expected score 0-100 from the side to move (Lichess win% sigmoid; forced mates are 100 / 0). */
export function winPercent(score: Score): number {
  if ('mate' in score) return score.mate > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * score.cp)) - 1);
}

export function parseInfo(line: string): { multipv: number; score: Score; pv: string[] } | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const t = line.split(' ');
  const at = (k: string) => t.indexOf(k);
  const si = at('score');
  if (si < 0) return null;
  const kind = t[si + 1];
  const value = Number(t[si + 2]);
  if (!Number.isFinite(value) || (kind !== 'cp' && kind !== 'mate')) return null;
  if (t[si + 3] === 'lowerbound' || t[si + 3] === 'upperbound') return null;
  const mi = at('multipv');
  return { multipv: mi >= 0 ? Number(t[mi + 1]) : 1, score: kind === 'cp' ? { cp: value } : { mate: value }, pv: t.slice(at('pv') + 1) };
}

export class UciEngine {
  private waiters: ((line: string) => void)[] = [];
  private ready: Promise<void>;
  name = 'unknown';

  constructor(private transport: EngineTransport) {
    transport.onLine((line) => {
      if (line.startsWith('id name ')) this.name = line.slice(8).trim();
      for (const w of [...this.waiters]) w(line);
    });
    this.ready = this.until((l) => l === 'uciok', 'uci').then(() => this.until((l) => l === 'readyok', 'isready'));
  }

  private until(done: (line: string) => boolean, command: string, onLine?: (line: string) => void): Promise<void> {
    return new Promise((resolve) => {
      const w = (line: string) => {
        onLine?.(line);
        if (done(line)) {
          this.waiters = this.waiters.filter((x) => x !== w);
          resolve();
        }
      };
      this.waiters.push(w);
      this.transport.send(command);
    });
  }

  /** Best lines for the side to move, best first. One search at a time. */
  async analyse(fen: string, nodes: number, multipv: number): Promise<PvLine[]> {
    await this.ready;
    this.transport.send(`setoption name MultiPV value ${multipv}`);
    this.transport.send(`position fen ${fen}`);
    const latest = new Map<number, PvLine>();
    await this.until(
      (l) => l.startsWith('bestmove'),
      `go nodes ${nodes}`,
      (l) => {
        const info = parseInfo(l);
        if (info && info.pv[0]) latest.set(info.multipv, { move: info.pv[0], score: info.score, pv: info.pv });
      },
    );
    return [...latest.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }

  async newGame(): Promise<void> {
    await this.ready;
    this.transport.send('ucinewgame');
    await this.until((l) => l === 'readyok', 'isready');
  }

  terminate(): void {
    this.transport.terminate();
  }
}

/** Browser transport: the vendored single-threaded WASM build, in a Web Worker. */
export function browserEngine(): UciEngine {
  const worker = new Worker(new URL('./engine/stockfish-19-lite-single.js', document.baseURI));
  return new UciEngine({
    send: (c) => worker.postMessage(c),
    onLine: (cb) => worker.addEventListener('message', (e) => typeof e.data === 'string' && cb(e.data)),
    terminate: () => worker.terminate(),
  });
}
