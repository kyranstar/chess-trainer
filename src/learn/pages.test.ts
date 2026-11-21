import { describe, expect, it } from 'vitest';
import { LESSONS } from '../content';
import { LEAD_IN_MAX, lessonPages, pageOfStep } from './pages';

describe('lesson pages (ADR-064): a page to read, or a question', () => {
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: every step is on exactly one page, and every board has a text', (_id, lesson) => {
    const pages = lessonPages(lesson);
    const seen = pages.flatMap((p) => (p.kind === 'read' ? p.steps : [p.step]));
    expect([...seen].sort((a, b) => a - b)).toEqual(lesson.steps.map((_, i) => i));
    for (const p of pages) {
      if (p.kind === 'read') {
        expect(p.paragraphs.length, 'a page that is only a board').toBeGreaterThan(0);
        expect(p.figures.length).toBeLessThanOrEqual(2);
      } else {
        expect(p.leadIn.join(' ').length, 'a lead-in too long to sit above the board').toBeLessThanOrEqual(LEAD_IN_MAX);
        expect(lesson.steps[p.step]!.type).toBe('try');
      }
    }
  });

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: saved progress opens on the page that holds the step', (_id, lesson) => {
    const pages = lessonPages(lesson);
    lesson.steps.forEach((_, i) => {
      const p = pages[pageOfStep(pages, i)]!;
      const holds = p.kind === 'ask' ? p.step === i : p.steps.includes(i) || p.leadInFor === i;
      expect(holds, `step ${i}`).toBe(true);
    });
  });

  it('a question right after a diagram gets its lead-in on a reading page with the diagram', () => {
    const lesson = LESSONS.find((l) => l.id === 'lasker-attack-and-defense')!;
    const pages = lessonPages(lesson);
    expect(pages[0]).toMatchObject({ kind: 'read', steps: [0] });
    // "Thus, in Diagram 5, White could attack…": the first page names the diagram, so it shows it.
    expect(pages[0]!.kind === 'read' && pages[0]!.figures.map((f) => f.caption)).toEqual(['Diagram 5']);
    expect(pages[1]).toMatchObject({ kind: 'read', steps: [1], leadInFor: 2 });
    expect(pages[2]).toMatchObject({ kind: 'ask', step: 2, leadIn: [] });
  });

  it('captions say what the position is', () => {
    const captions = LESSONS.flatMap((l) => lessonPages(l).flatMap((p) => (p.kind === 'read' ? p.figures.map((f) => f.caption) : [])));
    expect(captions).toContain('Diagram 5');
    expect(captions.some((c) => /^Diagram \d+, after /.test(c))).toBe(true);
    expect(captions).toContain('From the text');
    for (const c of captions) expect(c).toMatch(/^(Diagram \d+(, after .+)?|From the text)$/);
  });

  it('a figure is always drawn from White, as printed', () => {
    for (const l of LESSONS) for (const p of lessonPages(l)) if (p.kind === 'read') for (const f of p.figures) expect(f.orientation).toBe('white');
  });
});
