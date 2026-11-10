import { describe, expect, it } from 'vitest';
import { applyUci, fenOf, positionFromFen } from '../chess/rules';
import { CONCEPT_BY_ID, CONCEPTS, lessonAlternatives, LESSONS, LINK_PROVIDERS, SOURCE_BY_ID, THEMES } from './index';

describe('curated content', () => {
  it('has a concept catalogue with unique ids and resolvable prerequisites', () => {
    expect(CONCEPTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CONCEPTS.map((c) => c.id)).size).toBe(CONCEPTS.length);
    for (const c of CONCEPTS) for (const p of c.prereqs) expect(CONCEPT_BY_ID.has(p), `${c.id} -> ${p}`).toBe(true);
  });

  it('has no prerequisite cycles and lists prerequisites before dependants', () => {
    for (const c of CONCEPTS) for (const p of c.prereqs) expect(CONCEPT_BY_ID.get(p)!.order, `${p} before ${c.id}`).toBeLessThan(c.order);
  });

  it('every theme used by a concept has a CC0 definition', () => {
    for (const c of CONCEPTS) {
      for (const t of c.themes) expect(THEMES[t], `${c.id}: ${t}`).toBeDefined();
      if (c.descriptionTheme) expect(THEMES[c.descriptionTheme]).toBeDefined();
    }
  });

  it('links are https, point at a known linked provider, and never at a local source', () => {
    for (const c of CONCEPTS) {
      for (const l of c.links) {
        expect(l.url.startsWith('https://'), l.url).toBe(true);
        expect(LINK_PROVIDERS[l.sourceId], l.sourceId).toBeDefined();
        expect(l.verified.length).toBeGreaterThan(0);
      }
    }
  });

  it('local lessons come from a source cleared for local use and belong to a concept', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(1);
    for (const l of LESSONS) {
      const src = SOURCE_BY_ID.get(l.sourceId);
      expect(src, l.sourceId).toBeDefined();
      expect(['public-domain-reviewed', 'cc0', 'licensed', 'user-authored']).toContain(src!.permission);
      expect(CONCEPT_BY_ID.get(l.conceptId)?.localLessons).toContain(l.id);
    }
  });

  it('every lesson position is legal and every lesson move is legal (chessops)', () => {
    for (const l of LESSONS) {
      for (const [i, step] of l.steps.entries()) {
        if (step.type === 'text') {
          expect(step.paragraphs.length).toBeGreaterThan(0);
          continue;
        }
        let pos = positionFromFen(step.fen);
        expect(fenOf(pos).split(' ')[0], `${l.id} step ${i + 1}`).toBe(step.fen.split(' ')[0]);
        if (step.type === 'try') {
          expect(step.moves.length % 2).toBe(1);
          expect(step.orientation).toBe(pos.turn);
          for (const uci of step.moves) pos = applyUci(pos, uci);
        }
      }
    }
  });

  it('every asked lesson move has engine evidence, and the moves recorded as its equals are other legal moves', () => {
    let tries = 0;
    let withEquals = 0;
    for (const lesson of LESSONS) {
      lesson.steps.forEach((step, i) => {
        if (step.type !== 'try') return;
        let pos = positionFromFen(step.fen);
        step.moves.forEach((uci, ply) => {
          if (ply % 2 === 0) {
            tries++;
            const alts = lessonAlternatives(lesson.id, i + 1, fenOf(pos));
            if (alts.length) withEquals++;
            for (const a of alts) {
              expect(a.uci, `${lesson.id} step ${i + 1}`).not.toBe(uci);
              expect(() => applyUci(pos, a.uci), `${lesson.id} step ${i + 1} ${a.uci}`).not.toThrow();
            }
          }
          pos = applyUci(pos, uci);
        });
      });
    }
    expect(tries).toBeGreaterThanOrEqual(50);
    expect(withEquals).toBeGreaterThanOrEqual(10);
    // A known case: after 1.e4 e5 2.Nf3 the text plays 2...Nc6, and 2...Nf6 is as good.
    const dev = LESSONS.find((l) => l.id === 'lasker-opening-development')!;
    const idx = dev.steps.findIndex((s) => s.type === 'try' && s.moves[0] === 'b8c6');
    const step = dev.steps[idx]!;
    expect(step.type === 'try' && lessonAlternatives(dev.id, idx + 1, step.fen).map((a) => a.uci)).toContain('g8f6');
  });

  it('the first concepts of the curriculum can be studied with no connection', () => {
    const early = CONCEPTS.slice(0, 7);
    expect(early.filter((c) => c.localLessons.length === 0).map((c) => c.id)).toEqual([]);
    expect(CONCEPTS.filter((c) => c.localLessons.length > 0).length).toBeGreaterThanOrEqual(13);
  });
});

