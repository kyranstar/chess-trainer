# Feasibility audit: Chessreps, Steps Method, iOS PWA storage, static hosting

Audit date: 2026-11-10. No logins, no access-control bypass. Every URL carries one verification label:

- `fetched-ok` = I fetched it on 2026-11-10 and saw the content described.
- `search-result-only` = appeared in a search result; I did not open it.
- `unverified` = not opened by me. Where I add "(listed in fetched X)" the URL string was copied from a page/API response I did fetch, but the target page itself was not opened.

Request volume: about 21 requests to chessreps.com, about 21 to stappenmethode.nl (incl. one sample PDF), 4 to chess-steps.com, the rest to webkit.org / MDN / GitHub / Cloudflare / Netlify docs.

---

## Part 1 — Chessreps

### 1.1 What it is, who makes it

- A spaced-repetition chess opening trainer (web, iPhone, iPad, Android). Operated by **Chessreps, LLC**, "a Washington State limited liability company" — https://www.chessreps.com/terms-and-conditions (`fetched-ok`).
- Founder named on the About page: "By Ethan Netz, founder of Chessreps · Updated November 3, 2026" — https://www.chessreps.com/about (`fetched-ok`).
- App Store listing "Chessreps - Master Openings", seller "CHESSREPS, LLC", requires iOS/iPadOS 15.0+ — https://apps.apple.com/app/id6744000612 (`fetched-ok`, read through a summarising fetch, not raw HTML).
- Training modes (About page): Learn, Practice (FSRS spaced repetition), Drill, Time Trials, Puzzles, Arena.
- Content tiers (About page + compare page): "60+ courses by grandmasters and titled players, and 800+ community courses", plus Chessreps' own first-party courses. The public catalogue API reported `total: 59` titled-author courses on the audit date.

### 1.2 Is the site readable by fetch?

Partly. The homepage https://www.chessreps.com/ (`fetched-ok`) returned only a title, a one-line description and a list of "agent discovery" links through the markdown fetcher — the interactive UI is a JavaScript app. But marketing/legal/course landing pages are server-rendered and readable: terms, plans, about, compare pages and each `/opening/<slug>` page (title, author in JSON-LD, intro note of line #1, line counts). The actual move trees of a course are not in the readable HTML beyond the first line's intro text, and I did not attempt to obtain them.

### 1.3 Subscription: price and what it includes

| Fact | Source |
|---|---|
| "Try Chessreps free for 7 days / Then $34.99/year, only $2.92/month"; "Unlimited access to 1000+ chess openings"; "Unlock all game modes, community courses, and the course creator" | https://www.chessreps.com/plans (`fetched-ok`) |
| "Chessreps offers a subscription membership that provides access to all Content on the Service, including both First-Party Content and User Content. Subscriptions are available on a monthly or annual basis." (ToS 3.1) | https://www.chessreps.com/terms-and-conditions (`fetched-ok`) |
| "Certain Content is available without a subscription, including select free courses and introductory portions of other courses." (ToS 3.3) | same |
| "Your subscription provides access to the Content available on the Service at any given time, not to any specific courses or materials." (ToS 4.1) — courses can be modified or removed | same |
| iOS in-app purchase prices listed: Yearly $49.99, Monthly $7.99, Weekly $6.99 | https://apps.apple.com/app/id6744000612 (`fetched-ok`, via summarising fetch) |
| Third-party listing says "$35 per year" | https://alternativeto.net/software/chessreps/about/ (`search-result-only`) |

Note the web price ($34.99/yr) and the App Store yearly IAP ($49.99) differ; the monthly web price was not shown on the plans page I fetched.

**Free vs paid rule (applies to every course below):** "The first line of every course is free to play without an account, and a 7-day free trial unlocks the rest." (https://www.chessreps.com/about, `fetched-ok`). The public API marks every titled course `firstLineFree: true`. Everything beyond line 1 is membership content.

### 1.4 Relevant courses

Source for the titled-author rows: the publicly advertised read-only endpoint `GET https://www.chessreps.com/api/agent/openings?q=&limit=100` (`fetched-ok`; returned 59 courses with name, author, colour, lineCount, firstLineFree, url). Course-page status is given per row.

**(a) Italian Game as White**

| Title | Author | Lines | URL | URL status |
|---|---|---|---|---|
| The Italian Game | GM Wei Yi | API says 122; the page itself shows "Learn 0/103" | https://www.chessreps.com/opening/the-italian-game-oy2wyx0 | `fetched-ok` (JSON-LD author "GM Wei Yi") |
| Italian Game | Chessreps first-party (JSON-LD has provider "Chessreps", no author) | 22 ("22 interactive lines covering Black's main replies. Free to start.") | https://www.chessreps.com/opening/italian-game | `fetched-ok` |
| Fried Liver Attack | GM Fidel Corrales | 46 | https://www.chessreps.com/opening/fried-liver-attack | `unverified` (listed in fetched API response) |
| Evans Gambit | FM Nikolai Maevskii | 33 | https://www.chessreps.com/opening/evans-gambit-5vc5wf5 | `unverified` (listed in fetched API response) |
| Scotch Gambit | NM Laura Smith | 24 | https://www.chessreps.com/opening/scotch-gambit | `unverified` (listed in fetched API response) |

The Wei Yi course intro (line 1, free) states its scope: "We'll start with 1.e4 e5 2.Nf3 Nc6 3.Bc4 ... against main lines such as 3...Bc5 or 3...Nf6, we'll surprise our opponents with some interesting yet highly challenging side variations". The API description says "c3 and d4 for the center, Ng5 against the Two Knights". The first-party 22-line course is the one the site's own beginner page links as "Start the Italian Game course".

Community Italian courses also exist in the sitemap (e.g. `/opening/my-italian-game-5ftia1y`, `/opening/italian-game-sidelines-wdqsfpw`, `/opening/giuoco-piano-greco-gambit-jrknqng`) — `unverified` (listed in fetched https://www.chessreps.com/sitemap.xml; pages not opened; authors unknown; these are user content).

**(b) Against the Caro-Kann as White**

| Title | Author | Lines | URL | URL status |
|---|---|---|---|---|
| Counter the Caro-Kann | CM Azel Chua | 30 | https://www.chessreps.com/opening/counter-the-caro-kann-qrhk82i | `fetched-ok` (JSON-LD author "CM Azel Chua"; description: "The Advance Variation: grab space early and make Caro-Kann players work for everything.") |

That is the only titled-author anti-Caro-Kann course in the 59-course catalogue. Community courses for White vs the Caro-Kann appear in the sitemap — all `unverified` (listed in fetched sitemap; pages not opened; titles inferred from slugs only):
`/opening/caro-kann-exchange-for-white-vqgxusq`, `/opening/crush-the-caro-with-the-panov-attack-iqp-2ga36ap`, `/opening/simple-exchange-caro-q5wl5nx`, `/opening/tal-vs-caro-8feaju5`, `/opening/caro-kann-tal-variation-7zkvcar`, `/opening/win-facing-the-caro-kann-with-the-two-knights-attack-e95208y`, `/opening/landau-gambit-anti-caro-kann-p5sxbj5`, `/opening/vs-caro-can-unshrwe`.

**(c) Beginner Black repertoire vs 1.e4 and 1.d4**

Chessreps' own recommendation page https://www.chessreps.com/openings/best-for-beginners (`fetched-ok`, "By Ethan Netz ... Updated November 4, 2026"): "As Black, answer 1.e4 with the Caro-Kann Defense (1...c6) and 1.d4 with the Queen's Gambit Declined (1...d5 and 2...e6)." It links these course pages:

| Role | Title | Author | Lines | URL | URL status |
|---|---|---|---|---|---|
| vs 1.e4 (site's pick) | Caro-Kann Defense | FM Milan Popovic | 40 | https://www.chessreps.com/opening/caro-kann | `unverified` (listed in fetched API response and linked from fetched beginners page) |
| vs 1.e4 | The Caro-Kann | IM Alex Astaneh | 30 | https://www.chessreps.com/opening/the-caro-kann-b0475m8 | `unverified` (listed in fetched API response) |
| vs 1.e4 | 1.e4 e5 | IM Arthur de Winter | 48 | https://www.chessreps.com/opening/1-e4-e5-5gwtar1 | `unverified` (listed in fetched API response) |
| vs 1.e4 | Counter 1.e4 with 1...e5 | NM Theo Slade | 32 | https://www.chessreps.com/opening/counter-1-e4-with-1-e5-f5b9r1s | `unverified` (listed in fetched API response) |
| vs 1.e4 | Scandinavian | IM Maksim Shchekachikhin | 84 | https://www.chessreps.com/opening/scandinavian-defense | `unverified` (API + beginners page) |
| vs 1.e4 | French Defense | NM Dan Heisman | 64 | https://www.chessreps.com/opening/french-defense | `unverified` (API + beginners page) |
| vs 1.d4 (site's pick) | Queen's Gambit Declined | FM Marko Makaj | 37 | https://www.chessreps.com/opening/queen-s-gambit-declined-2p2gmlm | `unverified` (API + beginners page) |
| vs 1.d4 | Queen's Gambit Accepted | FM Aleksa Alimpic | 51 | https://www.chessreps.com/opening/queen-s-gambit-accepted-49rc591 | `unverified` (listed in fetched API response) |
| vs London | Counter the London | FM Vuk Zegarac | 30 | https://www.chessreps.com/opening/counter-the-london-okmpc64 | `unverified` (listed in fetched API response) |
| vs 1.d4 (sharper) | Albin Countergambit | not seen | not seen | https://www.chessreps.com/opening/albin-countergambit | `unverified` (linked from fetched beginners page) |

All: first line free, remainder paid membership.

### 1.5 Import / export

- **Import: yes (official).** "Yes, the Chessreps course creator turns a PGN or a Lichess study into a course you can train. Paste or drop in a PGN, or give it a Lichess study link ... You can build a private course and train it with an account and no membership" — https://www.chessreps.com/compare/chessreps-vs-chessbook (`fetched-ok`, "checked November 3, 2026").
- **Export: no official PGN export found.** In Chessreps' own comparison table the "Build your own or import" row reads, for Chessreps, "Course creator: paste or drop a PGN, or import a Lichess study. It lists the gaps you will face most." and for the competitor "Import PGN, Lichess studies, or your Lichess and Chess.com games. Export to PGN." Export is credited only to the competitor. The word "export" does not appear in the plans, about, terms or the two course pages I fetched, and the App Store listing does not mention PGN. This is absence of evidence from public pages; I could not inspect the logged-in UI.
- **Public API:** https://www.chessreps.com/api/openapi.json (`fetched-ok`) describes only `GET /api/health`, `GET /api/agent/openings`, `GET /api/agent/community-courses` — "Public discovery and read-only agent endpoints". It returns catalogue metadata (name, author, colour, line count, URL), not moves. No PGN endpoint.

### 1.6 Terms of Service (https://www.chessreps.com/terms-and-conditions, `fetched-ok`; "Effective Date: December 18, 2025", footer "Last Updated: November 2, 2026")

Exact quotes:

- §6.2 Prohibited Conduct — "Copy, reproduce, distribute, or make available any Content except as expressly permitted;"
- §6.2 — "Use automated tools, bots, scrapers, or similar technology to access the Service or collect data;"
- §6.2 — "Reverse engineer, decompile, or disassemble any part of the Service;"
- §6.2 — "Circumvent, disable, or interfere with any security or access-control features of the Service;"
- §7.2 — "we grant you a limited, non-exclusive, non-transferable, revocable license to access and use the Service for your personal, non-commercial use."
- §7.3 — "Copy, modify, or distribute any Content except as expressly permitted;"
- §1 — "\"Content\" means any chess courses, lessons, exercises, variations, annotations, or other educational materials available on the Service."
- §5.4 (your own uploads) — "You are free to use, publish, license, or distribute your User Content elsewhere as you see fit."

Nothing in the ToS mentions export, PGN, or an API.

robots.txt (https://www.chessreps.com/robots.txt, `fetched-ok`): `User-agent: * / Allow: /`, `Content-Signal: ai-train=yes, search=yes, ai-input=yes`, `Disallow: /api/` with `Allow: /api/openapi.json`, `Allow: /api/agent/`, `Allow: /api/community-courses`.

**Tension to be aware of:** robots.txt and the published agent endpoints invite automated read access to catalogue metadata, while ToS §6.2 prohibits "automated tools, bots, scrapers" without carve-out. This audit's own fetches were automated reads of public pages only. For the product:

- Mirroring course lines is clearly prohibited (§6.2, §7.3) and there is no export — consistent with the "LINKED, not mirrored" invariant.
- Deep links to `/opening/<slug>` pages are stable-looking public URLs; hand-curate them in a static table rather than calling the catalogue API from the app. If automated catalogue refresh is ever wanted, get written permission first (the ToS lists a contact email).
- The legitimate data flow is one-way *into* Chessreps: the user can paste their own rights-cleared PGN into the Chessreps course creator.

---

## Part 2 — Steps Method (Stappenmethode)

**Site caveat:** every page on https://www.stappenmethode.nl/en (`fetched-ok`; the bare domain 301-redirects to `www`) currently displays a banner "TESTOMGEVING — dit is geen live website" ("test environment — this is not a live website"). The content looks complete, but the site appears mid-migration, so URLs may change.

### 2.1 Authors and structure

- "The Steps method has been developed by Rob Brunia and Cor van Wijgerden." — https://www.stappenmethode.nl/en/colophon/ (`fetched-ok`). Publisher contact: Stappenmethode.nl, Cor van Wijgerden, Coevorden, NL.
- "has officially existed since 1987" — https://www.stappenmethode.nl/en/info/history/ (`fetched-ok`).
- Six steps. Steps 1–5 each have a trainer manual plus workbooks; Step 6 is a self-study instruction book plus workbooks.
- Workbook families (https://www.stappenmethode.nl/en/info/workbooks/, `fetched-ok`): **basic** (core, with reminders), **extra** (repetition, second half mixed), **plus** (new/deeper subjects, Steps 1–5), **thinking ahead** (Steps 2 and 3), **mix** (no theme given; "if you solve 80% of the exercises correctly, you have really mastered the Step" as reported by the fetch summary).

| Step | What it covers (from official step page) | URL (`fetched-ok` for all) |
|---|---|---|
| 1 | "All the rules of chess are introduced, and much attention goes to basic playing skills"; mate deliberately postponed. Step 1 plus: X-ray protection, passed pawn, defending against mate. Base workbook about 486 exercises. | https://www.stappenmethode.nl/en/material/step1/ |
| 2 | "the first principles of tactics and positional play"; "attacking techniques and how to win material cleverly"; "At this level, all games are decided by tactics". Sample pages show double attack, elimination of the defence, luring away, discovered attack. Plus: pawn endings, stalemate danger. Thinking-ahead workbook starts here. | https://www.stappenmethode.nl/en/material/step2/ |
| 3 | Further tactical themes, defence against tactics, trapping, first pawn endings, thinking ahead/visualisation. Plus: minor promotion, intermediate move, rook pawn. | https://www.stappenmethode.nl/en/material/step3/ |
| 4 | "Tactics are largely about the preparatory move ... luring, eliminating the defence, chasing, aiming and clearance"; solutions "2½ moves deep"; material advantage, endgame strategy, weak pawns. | https://www.stappenmethode.nl/en/material/step4/ |
| 5 | More strategy: "pawn structure, the seventh rank, strong squares and open files"; defending; planned endgame play. Last manual for group training. | https://www.stappenmethode.nl/en/material/step5/ |
| 6 | "a self-study book for everyone"; "much attention for strategy, and the endgame returns in many chapters. Only one chapter is devoted to tactics." | https://www.stappenmethode.nl/en/material/step6/ |

### 2.2 Which steps fit roughly 450–800 online rapid

Official level guidance comes from the main English distributor, not the author's site:

- https://www.chess-steps.com/ (`fetched-ok`) lists: "Step 1 – Rating up to 800", "Step 2 – Rating up to 1400", "Step 3 – Rating up to 1600", "Step 4 – Rating up to 1750", "Step 5 – Rating up to 1900", "Step 6 – Rating up to 2100". The rating system is not specified (it is not stated to be online rapid).
- https://www.chess-steps.com/faq (`fetched-ok`): "Although there is a correlation between rating and step, rating is not the deciding factor which step a student should follow. For a student rated 500, workbook step 1 basic will be easy, but workbook plus and especially mix can still be a challenge. You do not have to reach a rating of 800 to start with Step 2. Being sufficient in Step 1 is key."
- https://www.chess-steps.com/chess-steps-explained (`fetched-ok`): "Solving Step 4 problems correctly in your workbook, doesn't do you much good if you still miss Step 1 moves from your opponent." and "Chess-Steps starts dealing with positional factors in Step 4."

**My inference (not an official statement):** for 450–800 online rapid, sequence against Step 1 plus / Step 1 mix as a mastery check, then Step 2 (base, extra, plus, thinking ahead, mix) as the main body; Step 3 is the next horizon. How a chess.com/Lichess rapid rating maps onto the distributor's unspecified rating scale is not verified.

### 2.3 Where it is sold

- https://www.stappenmethode.nl/en/shop/ (`fetched-ok`): "Sales of the English version are handled by Chess-Steps." Listed retailers: Chess-Steps (main distributor, worldwide), New in Chess, Chesslife (Australia), House of chess (Africa), Shredder (Chess Tutor download).
- https://www.chess-steps.com/ (`fetched-ok`) — webshop, "Chess-Steps is responsible for distributing and promoting the brand Chess-Steps, also known as 'The Steps Method' or 'de Stappenmethode'."
- https://www.newinchess.com , https://www.chesslife.com.au , https://houseofchess.co.za — `unverified` (links present on fetched shop page; not opened).
- Free official samples: https://www.stappenmethode.nl/en/material/download/ (`fetched-ok`; sample PDFs hosted on files.stappenmethode.nl) and interactive preview exercises at https://www.stappenmethode.nl/en/examples/ (`fetched-ok`).

### 2.4 Official software

- **Chess Tutor** — https://www.stappenmethode.nl/en/material/chess-tutor/ (`fetched-ok`): "The Chess Tutor is a Windows program for learning chess, based on the Steps method by Brunia / van Wijgerden." Steps 1–3 only: Step 1 "23 lessons, 1800 exercises and 66 games", Step 2 "21 lessons, 1960 exercises and 84 games", Step 3 "23 lessons, 2150 exercises and 93 games". "Both the CDs and the downloads run on Windows only." "The price is € 19.95." "Higher steps will not be made."
  - Contradiction on the same site: the history page says "Step 4 is on the agenda once the programmers have an Android and Apple version."
- Sold at https://www.shredderchess.com/windows/chess-tutor.html (`fetched-ok`): Steps 1, 2, 3 at 19.95 € each, "runs on all computers with Windows Vista, 7, 8, 10 or 11". Also http://en.chesstutor.eu/ (`unverified`, link on fetched page).
- No iOS or macOS version exists per these pages.
- The author is sceptical of on-screen solving (FAQ, https://www.stappenmethode.nl/en/faq/, `fetched-ok`, paraphrased by the fetch): on screen the position is shown after each move so working memory is not trained, and replies come automatically so students think more superficially.

### 2.5 Copyright position

- Sample workbook pages carry "© Cor van Wijgerden" on each page — https://files.stappenmethode.nl/01a179cb-a84b-7e95-8dff-82e9b865a739/en_lp_2.pdf (`fetched-ok`; Step 2 workbook sample, text extracted from first pages).
- Site footer: "© 2026 Stappenmethode.nl".
- Chess Tutor: "None of the chess positions and practice exercises in the program have been published before" — i.e. the exercise collections are treated as original authored works.
- I found **no licence or statement permitting reproduction** of exercises anywhere on stappenmethode.nl or chess-steps.com, and also no explicit written "no part may be reproduced" clause on the pages fetched. Default copyright applies: exercises, reminders and lesson text cannot be bundled. Using the public step/theme ordering as a sequencing reference and linking to the official pages is consistent with what you described; reproducing workbook positions or theme-page text is not supported by anything I found.

---

## Part 3 — iOS PWA storage durability (Safari on iOS 17 / 18 / 26)

Version naming note: after iOS 18 Apple moved to iOS 26 (Safari 26.0 post, Sep 15, 2025).

### Sources and dates

| # | Source | Published / modified | Status |
|---|---|---|---|
| S1 | WebKit blog, "Updates to Storage Policy" (Sihui Liu) — https://webkit.org/blog/14403/updates-to-storage-policy/ | Aug 10, 2023 (modified Sep 18, 2023) | `fetched-ok` |
| S2 | WebKit blog, "Full Third-Party Cookie Blocking and More" (John Wilander) — https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ | Mar 24, 2020 | `fetched-ok` |
| S3 | WebKit, "Tracking Prevention in WebKit" — https://webkit.org/tracking-prevention/ | page meta: published Jun 24, 2020, modified Apr 27, 2023 | `fetched-ok` |
| S4 | WebKit blog, "WebKit Features in Safari 17.0" — https://webkit.org/blog/14445/webkit-features-in-safari-17-0/ | Sep 18, 2023 | `fetched-ok` |
| S5 | WebKit blog, "WebKit Features in Safari 26.0" — https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ | Sep 15, 2025 | `fetched-ok` (via summarising fetch) |
| S6 | WebKit blog, "Workers at Your Service" (Youenn Fablet) — https://webkit.org/blog/8090/workers-at-your-service/ | Feb 7, 2018 | `fetched-ok` (via summarising fetch) |
| S7 | Apple, WWDC23 session 10120 "What's new in web apps" — https://developer.apple.com/videos/play/wwdc2023/10120/ | June 2023 (exact date not on page) | `fetched-ok` (transcript via summarising fetch) |
| S8 | MDN, "Storage quotas and eviction criteria" — https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria | last modified Jan 5, 2026 | `fetched-ok` |
| S9 | MDN, StorageManager.persist() — https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist | last modified Oct 12, 2026 | `fetched-ok` |
| S10 | MDN, Navigator.share() — https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share | last modified Jul 16, 2026 | `fetched-ok` |
| S11 | MDN browser-compat-data, `main` branch JSON (api/Navigator.json, api/StorageManager.json, api/Window.json, html/elements/a.json, api/ServiceWorker.json, api/FileSystemFileHandle.json) — https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/StorageManager.json and siblings | repository head as of 2026-11-10 | `fetched-ok` |
| S12 | WebKit Bugzilla 290847 — https://bugs.webkit.org/show_bug.cgi?id=290847 | reported 2025-04-01, status NEW | `fetched-ok` |
| S13 | WebKit Bugzilla 209407 — https://bugs.webkit.org/show_bug.cgi?id=209407 | reported 2020-03-22, RESOLVED FIXED | `fetched-ok` |

### 3.1 Quota (IndexedDB / Cache API / OPFS / localStorage / service worker)

- S1: "Starting in Safari 17.0, and in WebKit apps for iOS 17, iPadOS 17 and macOS Sonoma: For a browser app, the origin quota is up to 60% of the total disk space. For other apps, the origin quota is up to 15% of the total disk space."
- S1: "For a browser app, overall quota is up to 80% of the total disk space. For other apps, overall quota is up to 20% of the total disk space."
- S1: "When a web app is running standalone (as Home Screen Web App on iOS or Web App added to dock on macOS), it has the same origin quota and overall quota as when it is opened in a browser app."
- S1 caveat: "the quota is an upper limit of how much can be stored — there is no guarantee that a site can store that much, so error handling for QuotaExceededError is necessary."
- S4 on the pre-17 regime: "Previously, an origin had a starting storage limit of 1 GB. When exceeding that limit, the subsequent storage operation would fail in Home Screen web apps or prompt the user".
- S8 (MDN) restates the same 60% / 15% / 80% / 20% figures and "If the user has saved the site as a web app on the Home Screen or the Dock, it uses the same origin quota as the browser app".
- Cookies and HTTP cache are outside this policy (S1).

A multi-megabyte IndexedDB of attempts and events is nowhere near quota in either context.

### 3.2 Eviction and the 7-day rule

- S2 (origin of the rule): "deleting all of a website's script-writable storage after seven days of Safari use without user interaction on the site." Affected forms: Indexed DB, LocalStorage, Media keys, SessionStorage, Service Worker registrations and cache.
- S2 on Home Screen apps: "Web applications added to the home screen are not part of Safari and thus have their own counter of days of use. Their days of use will match actual use of the web application which resets the timer. We do not expect the first-party in such a web application to have its website data deleted."
- S3 (stronger wording, later document): "The first-party domain of home screen web applications is exempt from ITP's 7-day cap on all script-writeable storage, i.e. ITP always skips that domain in its website data removal algorithm."
- S8: "Safari proactively evicts data when cross-site tracking prevention is turned on. If an origin has no user interaction, such as click or tap, in the last seven days of browser use, its data created from script will be deleted."
- S1, general eviction: "It can happen under a few conditions: when exceeding the overall quota, when the system is under storage pressure, or when the site has not been interacted with by the user for some time". "WebKit normally evicts data on an origin basis: the data of an origin will be deleted as a whole." "Origin might be excluded from eviction if it has active page at the time of eviction, or its storage is in persistent mode."

Conclusion: used in a **Safari tab**, the app's IndexedDB is subject to the 7-day cap (7 days of Safari use with no interaction on the site) and to LRU eviction. Installed to the **Home Screen**, the first-party origin is exempt from the 7-day cap; storage-pressure/overall-quota eviction still applies unless the origin is in persistent mode.

### 3.3 `navigator.storage.persist()` and `estimate()`

- S1: "Starting in Safari 17.0, and in WebKit apps for iOS 17, iPadOS 17 and macOS Sonoma, the Storage API is fully supported."
- S1: "WebKit currently grants a request based on heuristics like whether the website is opened as a Home Screen Web App." No user prompt.
- S4: "An origin is exempt from eviction when its storage mode is persistent ... Critical bugs have been fixed to ensure the storage mode value is remembered across sessions."
- S8: "Safari and most Chromium-based browsers ... automatically approve or deny the request based on the user's history of interaction with the site and do not show any prompts to the user."
- S11 (compat data; iOS mirrors desktop Safari version numbers): `StorageManager.persist` and `persisted` Safari 15.2; `StorageManager.estimate` Safari 17; `estimate().usageDetails` not supported in Safari.
- S1 on estimate accuracy: "to reduce fingerprinting risk introduced by exposing usage and quota, quota might change based on factors like existing usage and site visit frequency."

Design consequence: call `persist()` from the installed app, read back `persisted()`, and surface the result as an explicit product state; never assume it was granted.

### 3.4 Does a Home Screen web app share storage with Safari?

No — treat them as two separate stores.

- S3: "the website data of home screen web applications is kept isolated from Safari".
- S7: "Home Screen web apps have a standalone, app-like experience on iOS, with separate cookies and storage from the browser."
- S7/S4 describe a one-time **cookie** copy only for macOS Add to Dock ("Safari will copy the website's cookies to the web app"; "Safari does not copy over any other kind of local storage"). Neither source says anything is copied on iOS Add to Home Screen.

So IndexedDB data created in a Safari tab should be assumed **not** to carry over when the user adds the app to the Home Screen (and removing the icon may discard the app's data — not verified from a primary source). The onboarding flow should be: install first, then start; and offer export in Safari / import in the installed app as the migration path.

iOS 26 change (S5): "By default, every website added to the Home Screen opens as a web app", with an "Open as Web App" toggle the user can switch off; a manifest is no longer required.

### 3.5 Service workers and offline launch

- Supported since iOS 11.3 (S6: "Safari Technology Preview 48, macOS High Sierra 10.13.4 and iOS 11.3 beta seed 2"; S11: Safari 11.1). S6 update note: available in Safari, SFSafariViewController apps, "and web applications saved to your home screen".
- S6 (2018): WebKit "will remove unused service worker registrations after a period of a few weeks", and caches unopened for a few weeks likewise. In Safari tabs this is now effectively governed by the 7-day cap (S2 lists "Service Worker registrations and cache"). Home Screen first-party origin is exempt from the cap (S3).
- S6's "50 MiB per partition" Cache API figure is from 2018 and superseded by the S1 quota model.
- S5: Home Screen web apps never required a service worker, but offline launch does need one precaching the app shell.
- I found no primary source documenting current offline-launch defects in iOS 17/18/26. This must be verified on a physical device (airplane-mode cold launch after device restart).

### 3.6 Saving an export file to Files / iCloud Drive

| Mechanism | iOS Safari support | Notes |
|---|---|---|
| Web Share API with files (`navigator.share({files})`) | S11: `share` Safari 12.1; `files` parameter and `canShare` Safari 14 (iOS mirrors) | S10: requires "transient activation" (button tap); "you should always test with `navigator.canShare()`". MDN's list of usually-shareable types includes `.txt`, `.csv`, `.pdf` and others; `.json` and `.zip` are **not** on that list. No primary source confirms the share sheet's "Save to Files" for a given type — test on device; consider a `text/plain` or `.csv` fallback container. |
| `<a download>` (Blob URL) | S11: Safari on iOS 13+ | Historically unreliable in Home Screen web apps: S13 (fixed "in (or possibly before) iOS 14.3"); S12, open since 2025-04-01, "File downloads and inline file display in iOS 18.4 Web App lead to navigation-less state" — "will result in an \"Open in …\" splash screen that prohibits further navigation inside the Web App." Works more predictably in a Safari tab. |
| File System Access pickers (`showSaveFilePicker`, `showOpenFilePicker`, `showDirectoryPicker`) | S11: **not supported** in Safari / iOS | No direct write to a user-chosen Files/iCloud location. |
| Origin Private File System (`navigator.storage.getDirectory`) | S11: Safari 15.2; `createWritable` Safari 26 (S5: "support for the File System WritableStream API") | Origin-private; not visible in the Files app, so it is not an export path. |
| Import (restore) | `<input type="file">` | Standard; not separately verified in this audit. |

Recommendation: make Web Share with a file the primary export path inside the installed app (guarded by `canShare`), keep `<a download>` as fallback, and include the export/restore round trip in the manual iPhone test checklist.

---

## Part 4 — Free static hosting for a ~5 MB PWA

| | GitHub Pages | Cloudflare Pages | Netlify (Free) |
|---|---|---|---|
| Free-tier limits | "Published GitHub Pages sites may be no larger than 1 GB"; "soft bandwidth limit of 100 GB per month"; "soft limit of 10 builds per hour" (not applied to custom Actions workflows); deployments time out after 10 minutes. On GitHub Free "the repository must be public". | 500 builds/month, 1 concurrent build, "up to 20,000 files", single asset max 25 MiB, 100 projects/account, 100 custom domains/project. Bandwidth not stated on the limits page. Docs now say "Start new projects with Workers"; for Workers static assets "Requests to static assets are free and unlimited." | Credit-based: "300 credit limit"; bandwidth 20 credits/GB, production deploy 15 credits each, web requests 2 credits per 10k. "On the free plan, your sites will automatically pause if they exceed monthly limits"; "if one site/web project exceeds its limits, all sites/projects on your account will be paused." |
| HTTPS | "All GitHub Pages sites, including sites that are correctly configured with a custom domain, support HTTPS"; enforceable redirect. | Not stated on the pages I fetched (see Could not verify). | "Add Custom domains with SSL" listed on Free. |
| Custom headers | No mechanism documented; docs note "you can't specify custom MIME types on a per-file or per-repository basis". Observed `cache-control: max-age=600` on https://pages.github.com/ (single observation, not documented). | Yes: `_headers` file in the output directory, max 100 rules, 2,000 chars per line; applies to static asset responses. | Yes: `_headers` file or `[[headers]]` in `netlify.toml`; "apply only to files Netlify serves from our own backing store". |
| Fit for 5 MB site | Fine | Fine | Fine, but roughly 20 production deploys consume the whole 300 credits (15 each), and exhaustion pauses the site. |

Sources (all `fetched-ok`): https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits ; https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site ; https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https ; https://developers.cloudflare.com/pages/platform/limits/ (last updated Sep 5, 2026) ; https://developers.cloudflare.com/pages/configuration/headers/ (Aug 25, 2026) ; https://developers.cloudflare.com/pages/ (Aug 25, 2026) ; https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ (Nov 3, 2026) ; https://www.netlify.com/pricing/ ; https://docs.netlify.com/manage/routing/headers/ (Dec 1, 2025) ; https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/ (Oct 7, 2026).

Notes that follow from standard web semantics rather than from a fetched page (treat as reasoning, not verified facts):

- A service worker's default scope is the directory of its script, so no `Service-Worker-Allowed` header is needed if `sw.js` sits at the app root; the lack of custom headers on GitHub Pages is therefore not a blocker for scope, only for cache tuning.
- A GitHub Pages *project* site lives at `username.github.io/<repo>/`, so it shares one origin (and therefore one storage bucket, quota, persistence flag and eviction unit) with every other project site of that account. A custom domain, or a dedicated `*.pages.dev` / `*.netlify.app` subdomain, gives the app its own origin. Given WebKit evicts "on an origin basis", a dedicated origin is preferable.
- GPL-3.0: none of the hosting docs I read restrict the licence of hosted JavaScript. The GPL obligation (make corresponding source available to recipients of the bundle) sits with whoever publishes the site; GitHub Free's public-repository requirement happens to satisfy that if the source lives in the same repo.

---

## Could not verify

1. **Chessreps PGN export**: no public page mentions one; I could not inspect the logged-in app. Treat as "no official export" until Chessreps confirms otherwise.
2. **Chessreps course pages not opened**: every URL labelled `unverified` above (titles/authors come from the catalogue API or sitemap slugs only). Community-course authors and quality are unknown.
3. **Wei Yi Italian course line count**: API says 122, the page says 103.
4. **Chessreps monthly web price**; reason for the App Store ($49.99/yr) vs web ($34.99/yr) difference.
5. **Whether Chessreps permits automated use of its published `/api/agent/` endpoints** given ToS §6.2 — the two documents conflict; needs written permission.
6. **Steps Method explicit reproduction policy**: only copyright notices found, no written licence or permissions statement. The book colophon pages were not available to me.
7. **Rating scale behind "Step 1 – Rating up to 800"** and its mapping to chess.com/Lichess rapid ratings.
8. **stappenmethode.nl "TESTOMGEVING" banner**: whether this is the final live site or a staging build served on the production domain.
9. **Chess Tutor future**: the site says both "Higher steps will not be made" and that Step 4 awaits Android/Apple versions.
10. **iOS: whether any data is copied from Safari to a Home Screen web app at install time** — sources say storage is separate and only document a cookie copy for macOS Dock; no iOS-specific statement on copying found.
11. **iOS: whether deleting the Home Screen icon deletes the app's storage** — no primary source found.
12. **iOS: exact `persist()` grant behaviour in a plain Safari tab** (only "heuristics" / "history of interaction" is documented).
13. **iOS: "Save to Files" availability in the share sheet for `.json` / `.zip` shared via `navigator.share`**, and whether bug 290847 still reproduces on current iOS 26.x — device test required.
14. **iOS: offline cold-launch reliability of Home Screen web apps** on iOS 17/18/26 — no primary-source statement; device test required.
15. **Web Share `files` first Safari version**: compat data says 14; I did not cross-check against a WebKit release post.
16. **Cloudflare Pages**: free-plan bandwidth and automatic HTTPS on `*.pages.dev` are not stated on the docs pages I fetched; https://www.cloudflare.com/products/pages/ (`fetched-ok`) gave no plan details.
17. **Netlify**: the pricing page says "300 credit limit" without the word "monthly"; the monthly reset is described in the billing FAQ and in a search summary. Forum reports of sites staying paused after reset (https://answers.netlify.com/t/project-remains-paused-after-credits-reset-300-300-credits-available/166289, `search-result-only`) are unconfirmed.
18. **GitHub Pages custom headers**: absence in docs, not an explicit "unsupported" statement; the `max-age=600` value is one observation.
19. **Hosting providers' terms of service** were not reviewed for licence-related restrictions.
