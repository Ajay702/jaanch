#!/bin/sh
# Saves your BharatCode API key to .env without showing it on screen.
#   sh scripts/set-key.sh
cd "$(dirname "$0")/.." || exit 1
printf 'Paste your BharatCode API key (starts with bc_), then press Enter: '
stty -echo 2>/dev/null
read -r KEY
stty echo 2>/dev/null
echo
KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
case "$KEY" in
  bc_*) ;;
  "") echo "No key entered. Nothing changed."; exit 1 ;;
  *) echo "That doesn't look like a BharatCode key (it should start with bc_). Nothing changed."; exit 1 ;;
esac
touch .env
grep -v '^BHARATCODE_API_KEY=' .env > .env.tmp 2>/dev/null
printf 'BHARATCODE_API_KEY=%s\n' "$KEY" >> .env.tmp
mv .env.tmp .env
chmod 600 .env
echo "Saved to .env (key ending ...$(printf '%s' "$KEY" | tail -c 4)). Testing it now:"
node bin/jaanch.js --check-ai
