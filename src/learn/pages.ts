/**
 * A lesson as pages (owner, 2026-11-20; ADR-064). "Often I think I am supposed to find a move but
 * it's just showing me the chess board": a lesson's steps are regrouped, the same way for every
 * lesson and without touching its text, into pages of two kinds that look different:
 *
 *  - a page to **read**: the book's words, with the position they are about as a small captioned
 *    figure ("Diagram 5"), drawn from White as printed, never "White to move";
 *  - a **question** ("Your turn"): the board at full size, a short lead-in above it if the book
 *    gives one, the question under it.
 *
 * Rules: no page is only a board. A board goes to the text that starts from it (the next text,
 * or the long lead-in of the next question); a board followed by another board goes to the text
 * before it; a board with nothing after it to read goes back to the last page read. A text that
 * names "Diagram N" also shows that diagram when it is the board next to it. A question's lead-in
 * stays above the board only when it is short and no diagram comes just before it; otherwise it
 * becomes a page to read, so a question page never scrolls (ADR-051) and every word is shown.
 */
import type { Lesson, LessonStep } from '../content/types';

/** About four lines of book text at phone width: what fits above the board without scrolling. */
export const LEAD_IN_MAX = 160;

export interface Figure { fen: string; caption: string; orientation: 'white'; step: number }

export type LessonPage =
  | { kind: 'read'; steps: number[]; paragraphs: string[]; figures: Figure[]; leadInFor?: number }
  | { kind: 'ask'; step: number; leadIn: string[] };

type PositionStep = Extract<LessonStep, { type: 'board' }>;

function caption(step: PositionStep): string {
  if (step.diagram === undefined) return 'From the text';
  return step.afterDiagramMoves?.length ? `Diagram ${step.diagram}, after ${step.afterDiagramMoves.join(' ')}` : `Diagram ${step.diagram}`;
}

function figure(step: PositionStep, index: number): Figure {
  return { fen: step.fen, caption: caption(step), orientation: 'white', step: index };
}

const names = (paragraphs: string[], diagram: number | undefined) =>
  diagram !== undefined && paragraphs.some((p) => new RegExp(`Diagram ${diagram}\\b`).test(p));

export function lessonPages(lesson: Lesson): LessonPage[] {
  const steps = lesson.steps;
  const pages: LessonPage[] = [];
  let pending: Figure[] = [];
  const lastRead = (): Extract<LessonPage, { kind: 'read' }> | undefined => {
    const p = pages[pages.length - 1];
    return p?.kind === 'read' ? p : undefined;
  };
  const leadInOf = (s: LessonStep | undefined) => (s?.type === 'try' ? (s.before ?? []) : []);

  steps.forEach((step, i) => {
    if (step.type === 'text') {
      pages.push({ kind: 'read', steps: [...pending.map((f) => f.step), i].sort((a, b) => a - b), paragraphs: step.paragraphs, figures: pending });
      pending = [];
      return;
    }
    if (step.type === 'board') {
      const f = figure(step, i);
      const next = steps[i + 1];
      const prev = lastRead();
      // The page just read names this diagram: it is shown there too, as a reminder.
      const named = prev && names(prev.paragraphs, step.diagram) && prev.figures.length < 2 && !prev.figures.some((x) => x.fen === f.fen);
      const forward = next?.type === 'text' || (next?.type === 'try' && leadInOf(next).length > 0);
      if (forward) {
        if (named) prev.figures.push({ ...f });
        pending.push(f);
      } else if (prev && pending.length === 0 && prev.figures.length < 2) {
        prev.steps.push(i);
        prev.figures.push(f);
      } else {
        pending.push(f);
      }
      return;
    }
    // A question.
    const leadIn = step.before ?? [];
    if (pending.length > 0 || leadIn.join(' ').length > LEAD_IN_MAX) {
      if (leadIn.length > 0) {
        pages.push({ kind: 'read', steps: pending.map((f) => f.step), paragraphs: leadIn, figures: pending, leadInFor: i });
        pending = [];
      } else {
        // A diagram right before a question with nothing to read: it goes back to the last page read.
        const prev = lastRead();
        if (prev) {
          prev.steps.push(...pending.map((f) => f.step));
          prev.figures.push(...pending);
          pending = [];
        }
      }
      pages.push({ kind: 'ask', step: i, leadIn: [] });
    } else {
      pages.push({ kind: 'ask', step: i, leadIn });
    }
  });
  // Boards left at the end go back to the last page read.
  if (pending.length > 0) {
    const prev = [...pages].reverse().find((p): p is Extract<LessonPage, { kind: 'read' }> => p.kind === 'read');
    if (prev) {
      prev.steps.push(...pending.map((f) => f.step));
      prev.figures.push(...pending);
    }
  }
  for (const p of pages) if (p.kind === 'read') p.steps.sort((a, b) => a - b);
  return pages;
}

/** The page that holds a step: where saved progress (a step index) opens. */
export function pageOfStep(pages: LessonPage[], step: number): number {
  const ask = pages.findIndex((p) => p.kind === 'ask' && p.step === step);
  const lead = pages.findIndex((p) => p.kind === 'read' && p.leadInFor === step);
  if (lead >= 0) return lead;
  if (ask >= 0) return ask;
  const read = pages.findIndex((p) => p.kind === 'read' && p.steps.includes(step));
  return Math.max(0, read);
}

/** The step a page is saved as (the format of `lessonProgress:<id>@<rev>` is unchanged). */
export function stepOfPage(page: LessonPage): number {
  if (page.kind === 'ask') return page.step;
  if (page.leadInFor !== undefined) return page.leadInFor;
  return page.steps[0] ?? 0;
}
