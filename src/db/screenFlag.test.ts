// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { exportBackup, importBackup, serializeBackup } from './backup';
import { deleteDb, openDb } from './db';
import { listFlags, screenFlag, setFlag } from './flags';

const names: string[] = [];
afterEach(async () => {
  for (const n of names.splice(0)) await deleteDb(n);
});

function page(html: string): HTMLElement {
  const main = document.createElement('main');
  main.innerHTML = html;
  return main;
}

describe('a flag on any screen (owner request, 2026-11-20)', () => {
  it('a screen flag keeps route, heading, the board and the note', () => {
    const main = page('<div class="page"><p class="kicker">Board vision</p><h1>Hanging pieces</h1><div class="board" data-fen="8/8/8/8/8/8/8/K6k w - - 0 1"></div><p>Status Demonstrated</p></div>');
    const f = screenFlag(main, '#/learn/safety.hanging-pieces', 'The board here looks like a puzzle', 1000);
    expect(f).toMatchObject({
      id: 'screen:#/learn/safety.hanging-pieces:1000', kind: 'screen', ts: 1000, route: '#/learn/safety.hanging-pieces',
      heading: 'Hanging pieces', fen: '8/8/8/8/8/8/8/K6k w - - 0 1', note: 'The board here looks like a puzzle',
    });
    expect(f.said).toContain('Status Demonstrated');
  });

  it('a screen with no board and no note keeps neither', () => {
    const f = screenFlag(page('<h2>Practice</h2><p>Just practise</p>'), '#/practice', '  ', 5);
    expect(f.fen).toBeNull();
    expect(f.note).toBeUndefined();
    expect(f.heading).toBe('Practice');
  });

  it('what the screen said is trimmed to 800 characters', () => {
    const f = screenFlag(page(`<h1>Long</h1><p>${'x '.repeat(1000)}</p>`), '#/x', '', 1);
    expect(f.said.length).toBeLessThanOrEqual(800);
  });

  it('screen flags travel in the backup', async () => {
    const a = openDb(`sf-a-${Math.random()}`);
    const b = openDb(`sf-b-${Math.random()}`);
    names.push(a.name, b.name);
    await setFlag(a, screenFlag(page('<h1>Learn</h1>'), '#/learn', 'too much text', 7));
    await importBackup(b, serializeBackup(await exportBackup(a)));
    expect((await listFlags(b))[0]).toMatchObject({ kind: 'screen', route: '#/learn', note: 'too much text' });
  });
});
