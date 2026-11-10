import { describe, expect, it } from 'vitest';
import { applyUci, fenOf, positionFromFen } from '../chess/rules';
import { CONCEPT_BY_ID, CONCEPTS, LESSONS, LINK_PROVIDERS, SOURCE_BY_ID, THEMES } from './index';

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
});
