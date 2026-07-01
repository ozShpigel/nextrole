#!/usr/bin/env bash
#
# Permanently rewrite git history to purge the two leaked secrets.
#
#   ⚠️  THIS REWRITES HISTORY AND REQUIRES A FORCE-PUSH.
#   ⚠️  REVOKE/ROTATE THE SECRETS FIRST — rewriting does NOT recall copies
#       that others (or GitHub's cache) may already hold. Revocation is what
#       actually neutralizes the leak; this script just cleans the repo.
#
# Prereqs:
#   - All collaborators have pushed their work (history will change underneath them).
#   - git-filter-repo installed:  pipx install git-filter-repo
#                                 (or: pip install git-filter-repo)
#   - Run from a FRESH mirror clone is safest, but it also works in-place on a
#     clean working tree.
#
# After running: force-push, then every collaborator must re-clone (or hard-reset).

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! command -v git-filter-repo >/dev/null 2>&1 && ! git filter-repo --version >/dev/null 2>&1; then
  echo "git-filter-repo not found. Install it:  pipx install git-filter-repo" >&2
  exit 1
fi

# The literal secrets are NOT stored in this repo (that would re-leak them).
# Create an untracked file listing them, one replacement per line, in the
# git-filter-repo --replace-text format:  <literal-secret>==><placeholder>
#
#   .secrets-to-scrub.txt   (already gitignored)
#
# Example contents (one per line):
#   <full-anthropic-key>==>***REMOVED-ANTHROPIC-KEY***
#   <full-mongodb-connection-uri>==>***REMOVED-MONGODB-URI***
#
replacements="${1:-.secrets-to-scrub.txt}"
if [ ! -f "$replacements" ]; then
  echo "Replacements file '$replacements' not found." >&2
  echo "Create it (untracked) with one '<secret>==><placeholder>' per line, then re-run." >&2
  echo "Pull the exact leaked strings from history with:" >&2
  echo "    git log --all -S 'sk-ant-api03' -p | grep -m1 'sk-ant-api03'" >&2
  echo "    git log --all -S 'mongodb+srv'  -p | grep -m1 'mongodb+srv'" >&2
  exit 1
fi

echo ">>> Rewriting history (this may take a moment)..."
git filter-repo --replace-text "$replacements" --force

echo ""
echo ">>> Local history rewritten. Verify the secrets are gone by grepping"
echo "    all blobs for each leaked literal (each should print nothing):"
echo "      git grep -nI '<secret>' \$(git rev-list --all)"
echo ""
echo ">>> filter-repo removes the 'origin' remote by design. Re-add and force-push:"
echo "      git remote add origin https://github.com/ozShpigel/nextrole.git"
echo "      git push origin --force --all"
echo "      git push origin --force --tags"
echo ""
echo ">>> Then have every collaborator re-clone. Old clones still contain the secrets."
