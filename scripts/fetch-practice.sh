#!/bin/sh
# Pulls the latest backup copy that the app sent to the owner's private repository
# (Progress -> Your data -> "Private copy for review"; ADR-048) into data/remote/, which is
# git-ignored. Needs the GitHub CLI signed in as the owner of that repository.
#
#   scripts/fetch-practice.sh [owner/name]      default: REVIEW_REPO from data/deploy.env
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/data/deploy.env" ] && . "$ROOT/data/deploy.env"
REPO="${1:-${REVIEW_REPO:-}}"
[ -n "$REPO" ] || { echo "Give the repository as owner/name, or set REVIEW_REPO in data/deploy.env." >&2; exit 1; }
OUT="$ROOT/data/remote"
mkdir -p "$OUT"
if ! gh api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/backup.json.gz" > "$OUT/backup.json.gz" 2> "$OUT/fetch.err"; then
  echo "No backup copy in $REPO yet (or no access): $(head -c 200 "$OUT/fetch.err")" >&2
  rm -f "$OUT/backup.json.gz"
  exit 2
fi
gunzip -f "$OUT/backup.json.gz"
SENT="$(gh api "repos/$REPO/commits?path=backup.json.gz&per_page=1" --jq '.[0].commit.committer.date' 2>/dev/null || echo unknown)"
echo "$OUT/backup.json (sent $SENT)"
