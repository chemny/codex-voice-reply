#!/usr/bin/env bash
# Codex Voice Reply — remove hooks from agent configs. Leaves ~/.voice-reply intact.
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node "$SKILL_DIR/scripts/manage-hooks.mjs" remove "$SKILL_DIR"
node "$SKILL_DIR/scripts/manage-notify.mjs" remove "$SKILL_DIR" 2>/dev/null || true

echo
echo "Hooks (and the Codex notify fallback, if any) removed; backups saved as <file>.bak."
echo "Config, cache, and logs in ~/.voice-reply were kept."
echo "To remove them too:  rm -rf ~/.voice-reply"
echo "Restart your agent session to stop the voice."
