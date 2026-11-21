# Visual pass: three looks, one button system, lessons that say when they ask

Date: 2026-11-20. Owner request (sixteenth round, after accounts). Becomes ADR-064 when built.

## Intent

The owner asked for "a visual pass through the whole app for approachability and simplicity —
is everything super clear, or are there a bunch of buttons with different text? Is everything
aligned in a visually pleasing and standard way? I want this app to look like it was actually
designed by a real chess company with a design team." In Learn "there is often redundant
content, and the way that the chess boards are integrated is confusing — often I think I am
supposed to find a move but it's just showing me the chess board." "Every design choice needs
a reason." He was shown three directions on a canvas ("Chess Trainer directions": A Clubroom,
B Studio, C Night, each the same three screens) and decided: **every account picks its look on
first sign-in**, changeable later. He approved the list of fixes that apply to every look
("cool looks good", 2026-11-20).

## Goals

- Three looks, chosen per account, applied to every screen:
  - **Clubroom** (the app's identity, cleaned up): warm paper, white cards, felt-green main
    button, buff and green board, Atkinson Hyperlegible Next for the interface. Follows the
    phone's light/dark setting.
  - **Studio**: cool near-white, shadowed white surfaces, cobalt main button, slate-blue board,
    Inter. Follows light/dark.
  - **Night**: always dark, amber main button, walnut board, Space Grotesk headings over Inter.
  - All three set book text in Literata (the author's words stay distinguishable from the
    app's, ADR-051).
- **A "Pick a look" step** on first open after "Hi, Sam" (three previews of Today, one tap),
  shown once to accounts already past first open; **Look** on the Account page; the choice
  travels with the account (a portable setting) and is applied before the database opens on
  later launches (kept in the device's storage too). Screens before sign-in use the device's
  last look, else Clubroom. Local mode (no accounts) offers the same choice under Your data.
- **Lessons say when they ask.** A page to read shows the book's diagram small, framed and
  captioned ("Diagram 5"), always from White as printed, never "White to move", never a
  full-size board; no page is only a board (a board step becomes the figure of the text it
  belongs to). A question is marked **Your turn**, with the book's lead-in above the board, the
  board at full size, the question under it, buttons pinned: the exercise layout (ADR-051).
- **Lesson opening:** the title and one line of source ("Edward Lasker, *Chess and Checkers*
  (1918)"); the notation note as one line where the text uses old notation; how the excerpt
  was checked behind an info button.
- **One button system:** one filled main button per screen; everything else secondary (one
  style) or a quiet text link for leaving; main 52 px, secondary 48 px, the same radius per
  look; one word per action everywhere (table below); back links in one style ("‹ Place").
- **Today:** the greeting, then one card: "Today's training · 30 min" with the four parts
  (each with its subject and minutes) and **Start training**; under it "Just practise" and
  "Play a game" side by side as secondary; the length and the baseline behind the card's
  minutes; standing explanation lines removed unless something needs attention (the app not
  yet stored for offline, the practice pack missing). A running session shows Resume with its
  parts and the current one marked.
- **Learn:** "4 of 29 learned" in one line, an **Up next** card with Start, the list with plain
  states (Learned, Check due, Studied, Not started) and no "Lesson on device / Online lesson"
  meta unless offline (then "Needs a connection" on rows that need one).
- **Concept page:** title, definition, one plain status sentence ("Learned: passed the check,
  5 of 5"), the one action the state calls for as the main button (Start lesson / Take the
  check / Read again), practice as secondary, other lessons folded under "More lessons", the
  evidence detail (counts, plausible range) behind "About this".
- **Everywhere:** icons in the tab bar; one page-header pattern (small kicker, title, optional
  action on the right); form fields styled in every type (`input` without a type and `email`
  are bare today); cards one radius and border per look.

## Non-goals

- New features, new measures, new content. No lesson text changes (verbatim from the books).
- Rewriting Progress's charts: they take the look's tokens (series, event, ramp colours) and
  the card style; their content and layout stay (ADR-061/062).
- A per-device look different from the account's.

## Anti-goals

- A look that breaks the meaning of colour: after an answer, You / Game / Best / Other chips
  must stay distinct from each other and from the main button's colour in every look (Studio's
  blue accent and Night's amber would collide with Best's blue and You's amber as they are).
- Contrast under 4.5:1 for text on its background in any look, light or dark.
- A look that needs the network (fonts must be bundled: the app works offline).
- Moving the board between phases of an exercise (ADR-051) or making any screen scroll
  sideways at 390 px.

## Approaches considered

For the looks: CSS custom properties per look on `<html data-look>` (chosen: the app already
styles everything through tokens in `src/styles.css`; three token sets, plus dark variants for
Clubroom and Studio, change the whole app with no component forks) against per-look component
variants (three times the markup to keep in step; rejected) and a CSS-in-JS theme object
(a rewrite of the styling for no gain; rejected). Fonts bundled with `@fontsource` (as the two
today), pinned.

For lessons: regroup steps into pages at render time (chosen: content files and the saved
progress format stay as they are; a saved step index maps to the page that holds it) against
rewriting the lesson files (touches verified content; rejected).

## Design

### Tokens per look

Every colour, font, radius and shadow used by components comes from tokens: today's names
stay (`--paper`, `--surface`, `--ink`, `--muted`, `--rule`, `--felt` as the main colour,
`--felt-ink`, `--board-light`, `--board-dark`, `--pencil` highlight, `--flag`, `--good`,
`--you`, `--game`, `--best`, `--other` and their `-soft`, chart tokens), plus `--display`
(heading font), `--radius-card`, `--radius-button`, `--shadow-card`, `--secondary-bg`,
`--secondary-ink`, `--secondary-border`. The board's squares, coordinates and highlights read
tokens (the board's colours are hard-coded today). Each look sets every token; Clubroom and
Studio also set them for dark. Values come from the canvas; the move-chip colours are chosen
per look to stay apart from its main colour (Studio: Best becomes a green-teal; Night: You
becomes a coral), checked by a test (below).

### Pick a look

A step after hello on first open (and once for accounts already past it): "Pick a look", three
tiles, each a small static rendering of Today in that look (drawn with the look's tokens, so
it is what the app will look like), the current one marked, **Continue**. Stored as the portable
setting `look` (stamped, so it travels and a later change wins) and in `localStorage['ct.look']`
so the next launch paints in it before anything loads. Account page: a **Look** row with the
same three tiles. Local mode: under Your data.

### Button words

| Action | Word | Where |
|---|---|---|
| next page of a flow (lesson, onboarding, summary) | Continue | everywhere |
| next position in a run | Next | runs |
| reveal the answer | Show the answer | puzzles, lessons, own-game questions |
| after a reveal, play it by hand | Play it yourself | as now (ADR-058) |
| answer again | Try again | everywhere |
| previous page | Back | lessons, flows |
| leave | ‹ Place name (a link) | top left |
| end a session | End session | session bar (with the confirm) |

Everything else keeps its specific label (Start training, Invite, Sign out …). The full
inventory of today's labels is taken in the plan and each mapped to this table or kept with a
reason.

### Screens touched

Today, Learn home, concept page, lesson player (pages, figure, Your turn), the run frame and
every exercise's buttons, Practice home, Progress (tokens and card style only), Your data,
Account, Manage access, the onboarding screens, the tab bar.

## Verification

- A unit test over each look's tokens: text/surface and text/paper contrast ≥ 4.5:1, muted ≥
  4.5:1, main button text on main colour ≥ 4.5:1; the four chip colours and the main colour
  pairwise apart in hue and in lightness (the dataviz validator's thresholds), light and dark.
- Browser tests updated for the new words; new ones: the look step on first open and the
  choice applied (the `data-look` attribute and a token value), the change on Account, a
  lesson's reading page has a captioned figure and no "to move", its question page says "Your
  turn" with the lead-in above the board, no page that is only a board; every existing test
  still passes.
- Screenshots of every screen named above in each look (and dark for Clubroom and Studio) at
  390 by 844 and on a wide screen, looked at; no sideways scroll; the board in the same place
  through an exercise's phases.
- Live after deploy: the owner's look step on his next open.

## Left to the builder

Exact token values within the canvas's palettes and the tests' thresholds, the tile drawings,
icon shapes, which explanation lines count as "needs attention", and the words for labels the
table does not cover.
