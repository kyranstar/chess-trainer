/**
 * Runner for the practice audit. Not part of the test suite:
 *
 *   scripts/fetch-practice.sh                      # or use a backup file exported from the app
 *   BACKUP=data/remote/backup.json npx vitest run -c vitest.audit.config.ts
 *
 * Writes data/audit/report.txt and report.json (data/ is git-ignored: the report is private).
 * Options: DAYS (default 3), NODES (default 1500000), STOCKFISH (default: stockfish on PATH).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { it } from 'vitest';
import { parseBackup } from '../../src/db/backup';
import { type EngineTransport, UciEngine } from '../../src/engine/uci';
import type { Puzzle } from '../../src/puzzles/types';
import { auditBackup, renderReport } from './audit';

function nativeEngine(path: string): { engine: UciEngine; stop: () => void } {
  const child = spawn(path, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout });
  const transport: EngineTransport = {
    send: (c) => child.stdin.write(`${c}\n`),
    onLine: (listener) => lines.on('line', listener),
    terminate: () => child.kill(),
  };
  const engine = new UciEngine(transport);
  transport.send('setoption name Threads value 4');
  transport.send('setoption name Hash value 256');
  return { engine, stop: () => child.kill() };
}

it('audit', async () => {
  const file = process.env.BACKUP;
  if (!file) throw new Error('Set BACKUP to a backup file (see the comment at the top of this file).');
  const backup = await parseBackup(readFileSync(file, 'utf8'));
  const puzzles = new Map((JSON.parse(readFileSync('public/packs/lichess-core.json', 'utf8')) as Puzzle[]).map((p) => [p.id, p]));
  const { engine, stop } = nativeEngine(process.env.STOCKFISH ?? 'stockfish');
  try {
    const report = await auditBackup(backup, puzzles, engine, { days: Number(process.env.DAYS ?? 3), nodes: Number(process.env.NODES ?? 1_500_000) }, (s) => console.log(s));
    mkdirSync('data/audit', { recursive: true });
    writeFileSync('data/audit/report.json', JSON.stringify(report, null, 1));
    writeFileSync('data/audit/report.txt', renderReport(report));
    console.log(`data/audit/report.txt: ${report.ownMoves.length} own moves, ${report.sense.length} questions, ${report.puzzles.length} puzzles checked`);
  } finally {
    stop();
  }
}, 3_600_000);
