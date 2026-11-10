#!/bin/sh
# Publish the built app to GitHub Pages as a single-commit, deploy-only repository.
#
#   scripts/deploy-pages.sh <github-owner> [repo-name]
#
# What is published: the contents of dist/ (the app and its rights-cleared content packs)
# and source.tar.gz (a snapshot of the tracked source, as the GPL requires for a public copy).
# What is never published: data/ (raw downloads, your games and their analysis), git history,
# and anything from IndexedDB. Commits use the owner's GitHub no-reply address.
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

A personal, offline-first chess training app. This repository holds only the built files
served at https://$OWNER.github.io/$REPO/ . Source for this exact build: \`source.tar.gz\`
(GPL-3.0-or-later; commit $(git rev-parse --short HEAD)). No personal training data is stored here:
progress lives only in the browser of the device that uses the app.
TXT

cd "$OUT"
git init -q -b main
git add -A
git -c user.name="$OWNER" -c user.email="$OWNER@users.noreply.github.com" commit -q -m "Deploy build of $(cd "$ROOT" && git rev-parse --short HEAD)"
if gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  git remote add origin "git@github.com:$OWNER/$REPO.git"
  git push -q --force origin main
else
  gh repo create "$OWNER/$REPO" --public --description "Personal offline-first chess trainer (built app)" --source . --remote origin --push
  gh api -X POST "repos/$OWNER/$REPO/pages" -f 'source[branch]=main' -f 'source[path]=/' >/dev/null
fi
echo "Published. It can take a minute to appear at https://$OWNER.github.io/$REPO/"
