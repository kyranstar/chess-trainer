import { describe, expect, it } from 'vitest';
import { LESSONS } from '../content';
import { modernLesson } from './notation';

const texts = (l: (typeof LESSONS)[number]) => l.steps.flatMap((s) => [...('paragraphs' in s ? s.paragraphs : []), ...('before' in s ? (s.before ?? []) : []), ...('after' in s ? s.after : [])]);

describe('lessons in modern notation (owner, 2026-11-20)', () => {
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: no move is left in the old notation', (_id, lesson) => {
    const { unresolved } = modernLesson(lesson);
    expect(unresolved).toEqual([]);
  });

  it('Lasker: pieces and pawn moves', () => {
    const l = modernLesson(LESSONS.find((x) => x.id === 'lasker-opening-development')!).lesson;
    const t = texts(l).join(' ');
    expect(t).toContain('After (1) e4, e5 the only Pawn');
    expect(t).toContain('(2) Bc4, Bc5; (3) Nf3, Nc6; (4) d3, Nf6; (5) Nc3, d6; (6) O-O, O-O; (7) Bg5.');
    expect(t).toContain('(2) ...., exd4; (3) Qxd4');
  });

  it('Lasker: a pawn capture names its file, and checks are marked as today', () => {
    const t = texts(modernLesson(LESSONS.find((x) => x.id === 'lasker-checkmate')!).lesson).join(' ');
    expect(t).toContain('(1) e4, e5; (2) f4, Bc5; (3) fxe5??');
    expect(t).toContain('Qh4+');
  });

  it('Capablanca: descriptive notation read through the game', () => {
    const t = texts(modernLesson(LESSONS.find((x) => x.id === 'capablanca-opening-strategy')!).lesson).join(' ');
    expect(t).toContain('1 e4  or 1 d4');
    expect(t).toMatch(/1\. e4\s+e5 2\. Nf3/);
    expect(t).toContain('4. Bb5');
  });

  it('the lesson as stored is not changed', () => {
    const l = LESSONS.find((x) => x.id === 'lasker-checkmate')!;
    const before = JSON.stringify(l);
    modernLesson(l);
    expect(JSON.stringify(l)).toBe(before);
  });
});
