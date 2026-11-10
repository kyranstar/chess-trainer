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
npm run build
rm -rf "$OUT" && mkdir -p "$OUT"
cp -R dist/. "$OUT/"
git archive --format=tar.gz --prefix=chess-trainer/ -o "$OUT/source.tar.gz" HEAD
touch "$OUT/.nojekyll"
cat > "$OUT/README.md" <<TXT
# Chess Trainer (built app)

Built files served at https://$OWNER.github.io/$REPO/ . Source: the \`main\` branch of this
repository; \`source.tar.gz\` is the snapshot this build was made from (commit $(git rev-parse --short HEAD)).
No personal training data is stored here: progress lives only in the browser of the device
that uses the app.
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
if ! gh api "repos/$OWNER/$REPO/pages" >/dev/null 2>&1; then
  gh api -X POST "repos/$OWNER/$REPO/pages" -f 'source[branch]=gh-pages' -f 'source[path]=/' >/dev/null
fi
echo "Published. It can take a minute to appear at https://$OWNER.github.io/$REPO/"
