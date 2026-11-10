import { useState } from 'react';
import { useDb } from '../app/store';
import { saveJournalEntry } from '../db/db';
import type { GameJournalEntry } from '../db/types';

/** The game itself happens on the learner's own site; the app only frames it. */
export function PlayBlock({ onFinished }: { onFinished: () => void }) {
  return (
    <section className="concept" data-testid="play-block">
      <h1>Play one rapid game</h1>
      <p className="definition">10 minutes plus 5 seconds a move, one game, full attention. Close other tabs first.</p>
      <ul className="plain-list">
        <li>Play on your own account as usual; nothing is connected to this app.</li>
        <li>Finish the game, whatever the position.</li>
        <li>Come back here straight afterwards and write down what happened.</li>
      </ul>
      <p className="muted small">The app does not watch the game and cannot see the result.</p>
      <div className="actions">
        <a className="button" href="https://www.chess.com/" target="_blank" rel="noreferrer" data-testid="open-site">Open Chess.com</a>
        <button className="primary" data-testid="game-finished" onClick={onFinished}>The game is finished</button>
      </div>
    </section>
  );
}

type Draft = Pick<GameJournalEntry, 'color' | 'result' | 'url' | 'turningPoint' | 'nextTime' | 'ratingAfter'>;

export function ReflectBlock({ sessionId, onSaved }: { sessionId: string | null; onSaved: () => void }) {
  const db = useDb();
  const [d, setD] = useState<Draft>({ color: null, result: null, url: null, turningPoint: '', nextTime: '', ratingAfter: null });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function save() {
    if (!d.result) return setError('Choose the result first.');
    if (d.url && !/^https:\/\//.test(d.url)) return setError('The game link should start with https://');
    await saveJournalEntry(db, { ...d, url: d.url || null, sessionId, site: 'chess.com', timeClass: 'rapid', timeControl: '10+5', ts: Date.now() });
    onSaved();
  }

  const choice = <T extends string>(label: string, value: T | null, options: [T, string][], on: (v: T) => void, testid: string) => (
    <fieldset className="choice">
      <legend>{label}</legend>
      <div className="length-picker">
        {options.map(([v, text]) => (
          <button type="button" key={v} className={v === value ? 'chip is-on' : 'chip'} aria-pressed={v === value} data-testid={`${testid}-${v}`} onClick={() => on(v)}>{text}</button>
        ))}
      </div>
    </fieldset>
  );

  return (
    <form className="concept" data-testid="reflect-block" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h1>Reflect on the game</h1>
      <p className="muted">Your own words, written now. Later, when games can be imported and analysed, these notes sit next to the engine’s evidence.</p>
      {choice('Result', d.result, [['win', 'Won'], ['draw', 'Drew'], ['loss', 'Lost']], (v) => set('result', v), 'result')}
      {choice('You played', d.color, [['white', 'White'], ['black', 'Black']], (v) => set('color', v), 'color')}
      <label className="field">
        <span>Where did the game turn? (move number, what happened)</span>
        <textarea rows={3} value={d.turningPoint} data-testid="turning-point" onChange={(e) => set('turningPoint', e.target.value)} />
      </label>
      <label className="field">
        <span>One thing to do differently next game</span>
        <textarea rows={2} value={d.nextTime} data-testid="next-time" onChange={(e) => set('nextTime', e.target.value)} />
      </label>
      <label className="field">
        <span>Your rapid rating after the game (optional)</span>
        <input type="number" inputMode="numeric" min={100} max={3500} value={d.ratingAfter ?? ''} data-testid="rating-after" onChange={(e) => set('ratingAfter', e.target.value ? Number(e.target.value) : null)} />
      </label>
      <label className="field">
        <span>Link to the game (optional; stored, never opened by the app)</span>
        <input type="url" inputMode="url" placeholder="https://" value={d.url ?? ''} data-testid="game-url" onChange={(e) => set('url', e.target.value)} />
      </label>
      {error && <p className="note is-error" role="alert">{error}</p>}
      <div className="actions"><button className="primary" type="submit" data-testid="save-reflection">Save and finish</button></div>
    </form>
  );
}
