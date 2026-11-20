# Accounts for invited friends: Google sign-in, invites, an account copy, install guide

Date: 2026-11-20. Owner request (sixteenth round). Becomes ADR-063 when built.

## Intent

The owner wants to share the trainer with a few friends. Each friend signs in with Google, is
greeted by the name the owner gave them, links their own Chess.com account so their games come
in, is shown how to put the app on their Home Screen, and starts practising. Only addresses the
owner has invited get in, and only the owner manages the list. Progress belongs to the account:
it is kept on the phone (the app stays offline-first) and a copy is saved to the account, so a
new phone or the Mac picks up where the last one left off (owner's choice "B", 2026-11-20).

Flags (ADR-059) become the owner's alone and can be set from any screen, not only on an
answered position.

A visual pass of the whole app follows as a separate project; the screens added here will be
restyled with everything else then, so this round keeps them plain and consistent with the
current look.

## Goals

- Google sign-in on iPhone (Safari and the installed Home Screen app), Android, and the Mac.
- An invite list kept on the server and enforced there: an address not on it can sign in to
  Google but can read and write nothing, and the app shows only a "not on the list" screen.
- One admin, the owner. An admin page to invite (name + Google address), see who has signed in,
  whether they linked Chess.com and when they were last seen, remove access, and delete
  someone's saved copy.
- A greeting by the invited name on Today ("Good evening, Sam"), falling back to the Google
  first name.
- First run: welcome and sign-in, install guide (skippable, reachable later), link Chess.com
  (checked against Chess.com's public API, skippable), then Today.
- Per-account data: each account has its own local database on a device; nothing of one
  account is visible to another account on the same device.
- An account copy: the existing backup file, compressed, saved to the account when practice
  changes and merged in when the app opens online. Works offline; sends when back online.
- Owner-only things become admin-only: flags, the private GitHub copy (ADR-048), the Chessreps
  course rules (ADR-047), the starting ratings in `src/app/profile.ts`.
- The owner's phone keeps all its progress through the change, with nothing to do by hand.

## Non-goals

- Live two-way sync while two devices are open at once. Each open merges first; the last
  device to send writes the copy, and because merging is a union nothing is lost.
- Accounts other than Google. Chess.com or Lichess sign-in.
- Friends seeing each other, leaderboards, sharing.
- The owner reading friends' practice in the app. The admin page shows profile facts only.
- Lichess games for friends (the app reads Chess.com only today).
- The visual redesign (next project).

## Anti-goals (failure even if it works)

- The owner loses any practice history in the move to accounts.
- The app stops working offline, or a sign-in check blocks practice on the subway.
- A friend sees the owner's games, ratings, courses, flags or GitHub copy.
- The owner's email address, or anyone's, is written into the public source or bundle.
- A recurring manual step appears (renewing files, re-approving, running a script).
- A paid plan is required.

## Constraints found

- The app is a static site on GitHub Pages at `https://kyranstar.github.io/chess-trainer/`. Its
  browser storage is tied to that address: moving the app to another address would strand
  the owner's progress on the phone.
- Google sign-in through Firebase needs its sign-in helper on the same site as the app for
  redirect sign-in to work in Safari 16.1+, Firefox 109+ and Chrome 115+
  (firebase.google.com/docs/auth/web/redirect-best-practices). Popup sign-in is the documented
  alternative but is "less smooth for mobile users" and fragile in an installed iPhone app.
  The documented "self-host the helper code" option serves the helper files at
  `https://<app domain>/__/auth/…` and `/__/firebase/init.json`, with `authDomain` set to the
  app's domain; Google says the files must be re-synced periodically.
- `kyranstar.github.io` is one origin for every project site of the account, so helper files
  served at its root (a user-site repository `kyranstar/kyranstar.github.io`) are on the same
  origin as the app. That repository does not exist yet.
- Firebase Spark (free) limits: Firestore 1 GiB stored, 50K reads, 20K writes, 20K deletes per
  day; 1 MiB per document. Authentication 50K monthly users. Cloud Storage needs the paid plan,
  so the copy goes in Firestore.
- The owner's backup is 1.2 MB of JSON today (408 attempts, 99 games with analysis); gzip makes
  it a few hundred kB. Per account this is far under every limit.
- The owner's phone has no stored Chess.com username: the published build carries it as a
  default (`VITE_CHESSCOM_USERNAME`). That default cannot stay, or every friend would fetch the
  owner's games.
- `AGENTS.md`: tests must run locally with no cloud credentials or hosted endpoints.
- The repository and the built app are public. Firebase web config values are public by design;
  security rests on the server rules.

## Approaches considered

1. **Firebase (chosen).** Google sign-in, Firestore for invites, profiles and the account copy,
   free tier, no server code of ours; rules on Google's side enforce the list. The app stays on
   GitHub Pages; the sign-in helper is self-hosted at the root of kyranstar.github.io.
2. **Supabase.** The same on Postgres with row-level security, but a free project pauses after a
   week without use: a friend opening the app after a quiet week would find sign-in broken.
   Ruled out.
3. **Cloudflare Worker + D1 with our own token checks.** Free and flexible, but token
   verification, sessions and storage are ours to write and keep correct. More code for no gain.

Within Firebase, for where the sign-in helper lives:
- **Self-hosted helper at kyranstar.github.io (chosen):** no change of address, no migration.
  Cost: one new public repository holding only Google's helper files and a redirect page, and a
  scheduled GitHub Action there that re-downloads the files weekly and commits any change (so
  the periodic re-sync Google asks for is not a manual step).
- **Move the app to Firebase Hosting:** the documented simplest setup, but the owner's progress
  stays behind at the old address and would have to be carried over. Rejected for the risk.
- **Popup only:** no helper to host, but popups are the weak case on phones and in installed
  apps, which is where friends will use it.

The owner picked accounts with an account copy ("B") over progress on the phone only ("A").
The how (Firebase, the helper's location, the copy as merged backups) was left to the builder
and is the builder's call as stated here.

## Design

### Modes

- **Local mode** (no Firebase config built in): the app behaves exactly as today, no sign-in.
  `npm run dev`, `npm run build`, the tests, and anyone building from source get this.
- **Account mode** (Firebase config present at build time, from `data/deploy.env`, which is
  git-ignored): sign-in, invites and the account copy are on. The published build is this.
- **Fake account mode** for tests: the same account code against an in-browser fake of the
  account service, switched on by the test (no network). Used by the browser tests of the new
  screens.

All account code sits behind one adapter, `src/account/` (`AccountService`: auth state, sign
in/out, access check, profile, invites for the admin, copy push/pull), with a Firebase
implementation and a fake. Use the Firestore Lite SDK (no realtime, no offline cache: the app
has its own database) plus Firebase Auth, versions pinned.

### Server data (Firestore)

- `invites/{email-lowercased}`: `{ email, name, invitedAt }`. Admin reads and writes all;
  a signed-in user can read only the document of their own verified address.
- `admins/{email-lowercased}`: exists for the owner only, created once during setup in the
  Firebase console. Readable by that address only. The client learns it is admin by reading
  its own document. No email address appears in the repository: the rules test membership of
  this collection.
- `users/{uid}`: `{ email, name, chesscom, createdAt, lastSeenAt, appVersion, copyAt }`.
  The user reads and writes their own; the admin reads all (for the admin page).
- `users/{uid}/copy/manifest` and `users/{uid}/copy/manifest/chunks/{i}`: the account copy.
  Only that user reads and writes it; the admin may delete it but not read it.
- Rules require a verified Google address and (for everything under `users/`) an invite or
  admin document for it. Removing an invite cuts access at once on the server.
- Rules live in `firebase/firestore.rules`, are tested against the Firestore emulator
  (`npm run test:rules`, local, Java is installed), and are deployed by the builder.
- Privacy as it is: rules keep each copy private to its account, but the owner, as the Firebase
  project owner, could open any document in the Firebase console. Friends are told this in one
  line on the sign-in screen ("Your progress is saved to your account in Kyran's Firebase
  project.") — wording is the builder's, the fact must be said.

### Sign-in

- `authDomain` is `kyranstar.github.io`; helper files at `https://kyranstar.github.io/__/auth/`
  and `/__/firebase/init.json` come from the user-site repository, with `.nojekyll` (Jekyll
  drops folders starting with `_`). Extensionless helper paths (`handler`, `iframe`, `links`)
  must be served as HTML: GitHub Pages serves `x.html` for `/x`, which the builder verifies.
  Its `index.html` sends visitors on to `/chess-trainer/`. The weekly Action keeps the files
  in step with `<project>.firebaseapp.com`.
- Redirect sign-in on phones and in the installed app; popup on desktop browsers, falling back
  to redirect if the popup is blocked.
- The OAuth client gets `https://kyranstar.github.io/__/auth/handler` as a redirect URI; the
  Firebase authorized domains include `kyranstar.github.io`; the consent screen is published
  (not "Testing", which would admit only listed test users) with only the basic scopes.
- Offline: Firebase keeps the session on the device. The last access answer is kept on the
  device; if it was "allowed", the app opens offline and checks again when online. A removed
  invite takes effect at the next online open.

### Screens and flow

1. **Welcome** (not signed in): the app's name, one line on what it is, "Continue with Google".
2. **Not on the list** (signed in, not invited): "x@gmail.com isn't on the list. Ask Kyran to
   add it." and "Use another account". Nothing else of the app is reachable.
3. **First open of an invited account**: "Hi Sam" and then, in order and each skippable:
   - **Install** (only in a phone browser that is not already the installed app): steps for
     the platform. iPhone/iPad: Share → Add to Home Screen → Add, then open it from the Home
     Screen and sign in once there (an installed iPhone app has its own storage; the account
     copy brings progress across). Android Chrome: the browser's own install prompt as a
     button, else menu → Install app. Desktop is not prompted. Detect "installed" with
     `display-mode: standalone` and `navigator.standalone`. Glyphs drawn in SVG, no
     screenshots of other companies' screens.
   - **Link Chess.com**: a username field, checked with the public player endpoint; shows the
     player's name, avatar and ratings to confirm ("That's me"). Stored in the local setting
     the app already uses and in the profile. "I don't play on Chess.com" skips; games can be
     linked later from Account.
   - **Restore**: if the account has a copy and this device's database for the account is
     empty, "Bringing back your progress" until it is merged.
   Then Today.
4. **Today** greets by name: "Good morning / afternoon / evening, Sam" with the date.
5. **Account** page (from Today's header, a small initial or avatar): name, address, Chess.com
   link (change / unlink), "Saved to your account 3 min ago" or why not, "Install on your
   phone" (the guide), "Sign out". For the admin also "Manage access" and, moved here from
   Progress → More → Your data, the private GitHub copy. The backup file download/restore stays
   where it is.
6. **Admin: Manage access**: a form (name, Google address) and a list: name, address, state
   (invited, not signed in yet / signed in, last seen / Chess.com linked or not), with
   "Remove access". Once someone is removed, "Delete their saved progress" appears for them
   (with a confirmation): it deletes the server copy only, as clean-up after a removal; a
   person with access would simply send it again (builder's call, from the review). The admin
   cannot be removed.
7. **Not on the list, with progress on this device** (someone removed): besides the message,
   "Download your progress" (the existing backup file) when this device holds data for that
   account, so nobody loses their own practice by being removed.

### Local data per account

- Each account has its own IndexedDB database on a device: `chess-trainer:<uid>`.
- The existing database `chess-trainer` (the owner's phone today) may be adopted **only by the
  admin account**, and only after one confirmation on that device: "This device has practice
  from before accounts: 408 answers, the last on 20 November. Add it to your account?" with
  "Add to my account" and "Leave it out". Builder's call, from the review: every device that
  ever opened the published app holds the owner's games (the build fetched them by default),
  so a friend must never adopt one, and a browser of the owner's holding only test data must
  not be merged into his history unasked (merges cannot be undone). Adopted, it is used under
  its old name for that account from then on (no copy, no rename; the mapping is kept in the
  device's storage). Left out, it stays untouched on the device.
- After adoption, if the database has games but no stored Chess.com username, the username is
  set to the player name common to all stored games. This replaces the built-in default, which
  is removed from the published build.
- **No lock-out of existing progress** (builder's call, from the review): while the old
  database holds practice and has not been adopted or left out, the Welcome screen also offers
  "Continue on this device only", which opens the app on that database exactly as today (no
  account copy, no admin). Sign-in on the installed iPhone app cannot be tested by the
  builder; if it failed, the owner's daily practice would otherwise be blocked. The code is
  public, so this opens nothing that was closed.
- The app's module-level caches that hold database-derived data (the puzzle pool, sync state,
  the review-policy check) are reset when the account changes. Content caches are shared.

### The account copy

- Content: exactly `exportBackup()` (attempts, lesson events, sessions, journal, repertoire,
  games, portable settings including flags and the Chess.com username), gzip, base64, split
  into chunks of at most 900,000 characters.
- Push: when `dataSignature()` changes, at most every 2 minutes and when the app is hidden;
  online only. In one transaction: read the manifest; if its revision is newer than the last
  one merged here, pull and merge first and retry; else write the chunks and a manifest
  `{ rev+1, chunks, bytes, sha256, exportTime, deviceId, appVersion, schemaVersion }`.
- Pull: on sign-in and whenever the app comes to the front online: read the manifest; if its
  revision is newer than the last merged here, read the chunks, check the hash, and merge with
  the existing restore path (`importBackup`: validate everything first, append-only rows by id,
  editable rows by `updatedAt`, review state rebuilt). A copy from a newer app version is not
  merged until the app updates, and the screen says so.
- Shown on the Account page; failures are an explicit state ("Not saved: offline since 9:40"),
  never silent. The backup file stays available as before.
- **Settings and removals travel too** (builder's call, from the review): today's restore only
  fills settings missing on the device and never removes anything, which under automatic
  merging would undo an unlinked Chess.com account, bring back a removed repertoire move
  (`openings.declined` is not in the backup today) and a flag taken off, and never carry
  lesson progress to a device that has any. So each portable setting gets a change time, a
  removal is kept as a dated empty entry, and the merge takes the later of the two per key.
  `openings.declined` becomes portable. The backup format gains this as an optional section:
  older files restore as they do today, and the manual restore, the private GitHub copy,
  `scripts/flags.mjs` and `tools/audit` read both (format version and migration tests).

### Admin-only, and flags anywhere

- Admin-only: flags, the private GitHub copy, the Chessreps course rules (a non-admin account
  gets suggestions everywhere, as if no course were owned), and the starting ratings card.
  In local mode they behave as today.
- Flags anywhere: for the admin, a small flag control on every screen (in the run bar where
  there is one, otherwise in the page header area), with an optional one-line note ("What's
  wrong?"). A flag on a screen that is not an exercise is keyed `screen:<route>:<timestamp>`
  and keeps the route, the screen's heading, the visible text (trimmed), the board position if
  a board is on screen, the note and the app version. Flags on answered positions keep their
  current key and content. `scripts/flags.mjs` lists both kinds.

### Setup (done by the builder in the owner's Chrome, as asked)

Create the Firebase project (Spark), register the web app, enable Google sign-in, add the
authorized domain, create Firestore, publish the rules, create the owner's `admins` document,
add the redirect URI to the OAuth client, check the consent screen is published, create the
user-site repository with the helper files and the weekly Action, write the config into
`data/deploy.env`. The owner's Google account is used for these; nothing is paid.

## Verification

- Unit: adapter fake; chunking and reassembly; push/pull with a fake store including the
  revision race; legacy database adoption; username inference; admin-only gates.
- Rules: emulator tests for every collection and role (owner, invited, uninvited, removed,
  unverified, other user).
- Browser (fake account mode, both browsers): welcome → not on the list; invited → greeting →
  install step (phone, not installed) → link Chess.com (mocked) → Today greets by name; admin
  page invite / remove; a friend sees no flag, no GitHub copy, no courses; offline open of a
  signed-in account. Every existing test passes unchanged in local mode.
- Live: the owner's Chrome signs in on the published site and lands on Today with his
  progress; an invite is added and removed on the admin page; the helper files answer as HTML;
  a restore from the account copy in a fresh browser profile. Not verifiable by the builder: a
  friend's real sign-in, and the installed iPhone app (owner's hands).
- **Post-deploy checks from now on** (builder's call, from the review): the live site is behind
  Google sign-in, so the throwaway-browser smoke tests can reach only the Welcome screen, the
  helper files and the served build. Practice flows are checked in local mode and fake account
  mode before each deploy, and after it by a look in the owner's signed-in Chrome that answers
  nothing (anything answered there would enter his history for good). A dedicated Google test
  account would restore full live tests but needs the owner to create it; offered, not
  required.

## Left to the builder

File layout under `src/account/`, the fake's switch, exact wording, how the flag control looks
on non-run screens within the current style, chunk size below the limit, the Action's
schedule, the project id.
