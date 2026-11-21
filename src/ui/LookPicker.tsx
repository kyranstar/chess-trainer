/**
 * Pick a look (ADR-064): three tiles, each a small drawing of Today in that look's own tokens,
 * so what is picked is what the app will look like. A tap applies it at once.
 */
import { applyLook, isDark, LOOK_IDS, type LookId, LOOKS, resolveTokens } from './looks';

function systemDark(): boolean {
  return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function Tile({ id, on, onPick }: { id: LookId; on: boolean; onPick: (id: LookId) => void }) {
  const t = resolveTokens(id, systemDark());
  const look = LOOKS[id];
  return (
    <button type="button" className={`look-tile${on ? ' is-on' : ''}`} data-testid={`look-${id}`} aria-pressed={on} onClick={() => onPick(id)}>
      <span className="look-preview" aria-hidden style={{ background: t.paper, color: t.ink, fontFamily: t.ui, colorScheme: isDark(id, systemDark()) ? 'dark' : 'light' }}>
        <span style={{ fontFamily: t.display, fontWeight: 700, fontSize: '0.8rem' }}>Good evening</span>
        <span className="look-card" style={{ background: t.surface, borderColor: t.rule, borderRadius: `calc(${t['radius-card']} / 2)`, boxShadow: t['shadow-card'] }}>
          <span className="look-board" style={{ backgroundImage: `conic-gradient(${t['board-dark']} 0 90deg, ${t['board-light']} 90deg 180deg, ${t['board-dark']} 180deg 270deg, ${t['board-light']} 270deg)` }} />
          <span className="look-lines"><span style={{ background: t.ink }} /><span style={{ background: t.muted }} /></span>
        </span>
        <span className="look-button" style={{ background: t.felt, color: t['felt-ink'], borderRadius: `calc(${t['radius-button']} / 2)` }}>Start</span>
      </span>
      <span className="look-name">{look.name}</span>
      <span className="look-blurb">{look.blurb}</span>
    </button>
  );
}

export function LookPicker({ value, onPick }: { value: LookId; onPick: (id: LookId) => void }) {
  return (
    <div className="look-picker" role="group" aria-label="Look" data-testid="look-picker">
      {LOOK_IDS.map((id) => (
        <Tile key={id} id={id} on={id === value} onPick={(x) => { applyLook(x); onPick(x); }} />
      ))}
    </div>
  );
}
