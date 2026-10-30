#!/bin/sh
# Downloads the inputs into vendor/: the rendered book, its Verso sources at the pinned commit,
# and Lean's Unicode abbreviation table.
set -eu
cd "$(dirname "$0")/.."
COMMIT=4e28129fdd58037f8f5857548d5e99fe4fb0cc57
rm -rf vendor && mkdir -p vendor/tpil-src
python3 -I scripts/mirror.py vendor/site > /dev/null
tmp=$(mktemp -d)
git clone -q https://github.com/leanprover/theorem_proving_in_lean4.git "$tmp/tpil"
git -C "$tmp/tpil" checkout -q "$COMMIT"
cp -R "$tmp/tpil/book/TPiL" vendor/tpil-src/
echo "$COMMIT" > vendor/tpil-src/COMMIT
rm -rf "$tmp"
curl -sfL https://raw.githubusercontent.com/leanprover/vscode-lean4/master/lean4-unicode-input/src/abbreviations.json \
  -o vendor/abbreviations.json
