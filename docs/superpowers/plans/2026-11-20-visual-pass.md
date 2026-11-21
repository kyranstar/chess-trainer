# Visual pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three looks chosen per account (Clubroom, Studio, Night), one button system and vocabulary, a calmer Today and Learn, and lessons whose reading pages and questions look different.

**Architecture:** Look tokens live in TypeScript (`src/ui/looks.ts`) so they can be tested for contrast; `applyLook()` writes them as CSS custom properties on `<html>` (with the dark set when the look follows the system and the system is dark) and every component keeps styling through `var(--…)` in `src/styles.css`. The choice is the portable setting `look` (stamped, travels in the account copy) mirrored in `localStorage['ct.look']` and applied in `main.tsx` before the first render. Lesson pages come from a pure function over a lesson's steps (`src/learn/pages.ts`), so the content files and saved progress are untouched.

**Tech Stack:** React 19, TypeScript, CSS custom properties, `@fontsource-variable/inter` and `@fontsource-variable/space-grotesk` (pinned, bundled for offline), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-visual-pass-design.md`

## Global Constraints

- Palettes from the canvas (`Chess Trainer directions`): Clubroom paper `#F3F1EA`, surface `#FFFFFF`, ink `#1B241E`, muted `#5B665E`, rule `#E2DED2`, main `#1F4D36` / text `#F3EFDD`, board `#ECE6CF`/`#6F9468`; Studio paper `#F7F8FA`, surface `#FFFFFF`, ink `#0F172A`, muted `#5A6475`, rule `#E6E9EF`, main `#2453D8` / `#FFFFFF`, secondary `#E3E9F7`/`#1B3FA8`, board `#E3E9F2`/`#8AA0BF`; Night paper `#111315`, surface `#1B1E22`, ink `#ECEEF0`, muted `#A0A7B0`, rule `#2A2E34`, main `#F0B44C` / `#1A1405`, board `#F0D9B5`/`#B58863`. Dark sets for Clubroom and Studio are the builder's, from the current dark tokens.
- Fonts: Clubroom Atkinson Hyperlegible Next; Studio Inter; Night Space Grotesk headings + Inter; book text Literata in all.
- Main button 52 px (`3.25rem`), secondary 48 px (`3rem`); one radius per look (Clubroom 12, Studio 14, Night 14).
- Text contrast ≥ 4.5:1 on paper and surface, light and dark; chip colours (You, Game, Best, Other) and the main colour pairwise apart.
- No lesson file edited; `lessonProgress:<id>@<rev>` keeps storing a step index.
- ADR-051 holds: the board does not move through an exercise's phases; a question page does not scroll at 390×664.
- Every existing test keeps passing, with words updated where the vocabulary table changes them.
- Node 22.23.1: `source ~/.nvm/nvm.sh && nvm use >/dev/null &&` before commands.

## Review Focus

1. A first paint in the wrong look (flash of Clubroom before Night): the look must be applied before React renders. → Task 1 browser test "the chosen look is on the first paint".
2. Night with the system in light mode, Studio with the system in dark mode switching while open. → Task 1 unit test over `resolveTokens`.
3. A lesson whose first step is a board, two boards in a row, a lesson ending on a board, a question with no lead-in. → Task 4 unit tests over all 16 lessons.
4. Saved lesson progress from before the change opens on the page that holds the saved step. → Task 4 unit test.
5. The play-day suggestion arriving after launch does not move buttons. → Task 5 browser test.

---

### Task 1: Looks as tested tokens, applied before the first paint

**Files:** Create `src/ui/looks.ts`, `src/ui/looks.test.ts`. Modify `src/main.tsx`, `src/styles.css` (`:root` tokens become fallbacks; board, buttons, inputs, cards, tab bar read tokens), `package.json` (fonts), `src/db/stamps.ts` (`look` portable).

**Interfaces:** `type LookId = 'clubroom' | 'studio' | 'night'`; `interface Tokens { [cssVar: string]: string }`; `LOOKS: Record<LookId, { name: string; light: Tokens; dark: Tokens | null }>` (Night: `dark: null`, always its own set); `resolveTokens(id, systemDark: boolean): Tokens`; `applyLook(id: LookId): void` (writes tokens on `document.documentElement.style`, sets `data-look`, keeps `localStorage['ct.look']`, listens to `prefers-color-scheme`); `storedLook(): LookId` (localStorage, default `clubroom`); `contrast(a: string, b: string): number`.

- [ ] Tests first (`looks.test.ts`): every look and mode has every token Clubroom light has; ink/paper, ink/surface, muted/paper, muted/surface, main-ink/main ≥ 4.5; the four chip colours and main pairwise differ (ΔL ≥ 8 in OKLab lightness or hue ≥ 30°); `resolveTokens('night', false)` equals Night's set; `resolveTokens('studio', true)` is Studio's dark set.
- [ ] Run → FAIL. Implement. Run → PASS. Typecheck.
- [ ] Browser test (new `e2e/looks.spec.ts`): with `ct.look=night` in storage before load, the first screenshot frame's body background is Night's paper (read `getComputedStyle(document.body).backgroundColor` in an init script at DOMContentLoaded).
- [ ] Full suite green. Commit "Looks: tokens per look, tested for contrast, applied before the first paint (ADR-064)".

### Task 2: Pick a look (first open, Account, local mode)

**Files:** Modify `src/account/Onboarding.tsx` (step `look` after hello), `src/account/Gate.tsx` (once for onboarded accounts without `look`; apply the stored setting when the database opens), `src/account/AccountPage.tsx` (Look row), `src/ui/Data.tsx` (local mode), new `src/ui/LookPicker.tsx` (three tiles drawn with each look's tokens, testids `look-<id>`), `e2e/accounts.spec.ts`.

- [ ] Browser tests first: first open shows `look-picker` after hello, picking Night sets `data-look="night"` and survives reload; Account's Look changes it; an account already onboarded with no look sees the picker once.
- [ ] Implement; tests green; commit.

### Task 3: One button system, fields, cards, header, tab bar with icons, the word table

**Files:** `src/styles.css`, `src/App.tsx` (tab icons), every `src/ui/*.tsx` and `src/account/*.tsx` whose labels the table changes ("Show solution"/"Show the move"/"Show my move"/"Show a move that keeps it" → "Show the answer" unless the reason to keep differs and is written in the ledger), the e2e tests that read those words.

- [ ] Inventory of labels (grep) into the ledger with the mapping; update tests' expected words first (they fail), then the UI.
- [ ] Inputs of every type styled; `.button`/`button` primary, secondary, quiet per the constraints; back links one style.
- [ ] Full suite green; commit.

### Task 4: Lesson pages

**Files:** Create `src/learn/pages.ts`, `src/learn/pages.test.ts`. Modify `src/ui/LessonPlayer.tsx`, `src/styles.css`.

**Interfaces:** `type LessonPage = { kind: 'read'; steps: number[]; figures: { fen: string; caption: string }[]; paragraphs: string[] } | { kind: 'ask'; step: number; leadIn: string[] }`; `lessonPages(lesson: Lesson): LessonPage[]`; `pageOfStep(pages, stepIndex): number`.

- [ ] Tests first, over all 16 lessons: every step index appears in exactly one page; no read page without paragraphs; no ask page with a lead-in over 180 characters or after a diagram; at most two figures per page; captions as the spec says; `pageOfStep` maps every step; the hanging-pieces lesson's first page holds Diagram 5 with the first paragraph.
- [ ] Implement; LessonPlayer renders read pages (figure small, captioned, from White, no "to move") and ask pages ("Your turn", lead-in, board, question, pinned buttons); progress stored as the page's first step.
- [ ] Browser: a reading page has `lesson-figure` with a caption and no "to move"; the next question page shows "Your turn" and does not scroll at 390×664; existing lesson tests updated to pages. Commit.

### Task 5: Today, Learn home, concept page, Practice home

**Files:** `src/ui/Today.tsx`, `src/ui/Learn.tsx`, `src/ui/Practice.tsx`, `src/learn/curriculum.ts` (a `learnLabel(status)` with the five labels and its unit test), `src/styles.css`, tests.

- [ ] `learnLabel` tests first (each stage and refresh case → label; count rule). Implement.
- [ ] Today per spec (card with four parts and Start training; secondary row; play-day line and swap without moving; standing lines only when they need attention). Learn home (count line, Up next card, plain labels). Concept page (status sentence, one main action, More lessons folded, About this). Practice home (one main action, rows without filler).
- [ ] Browser tests updated; a new one: the play-day suggestion arriving after launch moves no button. Commit.

### Task 6: Progress, runs and the rest take the look; screenshots; records; deploy

- [ ] Chart tokens per look (`--ch-*`, `--dv-*`) in `looks.ts` (Night uses the validated dark values); run bar and exercises read tokens.
- [ ] Screenshot spec (`data/shots/r16looks.spec.ts`): every screen named in the spec × each look (+ dark for Clubroom and Studio) at 390×844 and 1280 wide; look at them; fix what is off.
- [ ] `npm run check`, `npm run test:rules`, `npm run e2e:churn` green; ADR-064, STATE, ROADMAP; push; deploy; live check of the look step in the owner's Chrome.
