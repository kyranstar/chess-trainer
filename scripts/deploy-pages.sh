#!/bin/sh
# Publish the built app to GitHub Pages: the `gh-pages` branch of the project's GitHub
# repository, rewritten as a single commit on every deploy.
#
#   scripts/deploy-pages.sh <github-owner> [repo-name]
#   DRY_RUN=1 scripts/deploy-pages.sh <github-owner> [repo-name]   # build the bundle in data/deploy, publish nothing
#
# What is published: the contents of dist/ (the app and its rights-cleared content packs)
# and source.tar.gz (a snapshot of the tracked source of exactly this build).
# What is never published: data/ (raw downloads, your games and their analysis) and anything
# from the browser's storage. The deploy commit uses the owner's GitHub no-reply address.
set -eu
OWNER="$1"
REPO="${2:-chess-trainer}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/data/deploy"
cd "$ROOT"

[ -z "$(git status --porcelain)" ] || { echo "Commit your changes first: the source snapshot is taken from HEAD." >&2; exit 1; }
# Optional settings for the published build, kept out of git (data/ is ignored):
#   data/deploy.env:  FIREBASE_CONFIG='<the Firebase web config as JSON>' (accounts, ADR-063: with it the
#                     published app has Google sign-in and invites; without it, it runs with no accounts)
#                     REVIEW_REPO=<owner/name of your private repository for backup copies> (optional;
#                     only fills in the field under "Private copy for review"; no token is ever built in)
# No Chess.com name is built in any more (ADR-063): each account links its own.
[ -f "$ROOT/data/deploy.env" ] && . "$ROOT/data/deploy.env"
rm -rf "$OUT" && mkdir -p "$OUT"
# Built straight into data/deploy so dist/ (which the tests serve) never holds a personalised build.
npx tsc --noEmit
VITE_FIREBASE_CONFIG="${FIREBASE_CONFIG:-}" VITE_REVIEW_REPO="${REVIEW_REPO:-}" npx vite build --outDir "$OUT" --emptyOutDir
git archive --format=tar.gz --prefix=chess-trainer/ -o "$OUT/source.tar.gz" HEAD
touch "$OUT/.nojekyll"
cat > "$OUT/README.md" <<TXT
# Chess Trainer (built app)

Built files served at https://$OWNER.github.io/$REPO/ . Source: the \`main\` branch of this
repository; \`source.tar.gz\` is the snapshot this build was made from (commit $(git rev-parse --short HEAD)).
No personal training data is stored here: progress lives in the browser of the device that
uses the app and, with accounts, in a copy in the person's account (Firebase).
TXT

if [ "${DRY_RUN:-}" = "1" ]; then
  echo "Dry run: bundle is in $OUT ($(du -sh "$OUT" | cut -f1)); nothing was published."
  exit 0
fi

cd "$OUT"
git init -q -b gh-pages
git add -A
git -c user.name="$OWNER" -c user.email="$OWNER@users.noreply.github.com" commit -q -m "Deploy build of $(cd "$ROOT" && git rev-parse --short HEAD)"
git push -q --force "git@github.com:$OWNER/$REPO.git" gh-pages
# GitHub usually turns Pages on by itself when a gh-pages branch appears; ask anyway and ignore "already enabled".
gh api -X POST "repos/$OWNER/$REPO/pages" -f 'source[branch]=gh-pages' -f 'source[path]=/' >/dev/null 2>&1 || true
echo "Published. It can take a minute to appear at https://$OWNER.github.io/$REPO/"
