#!/usr/bin/env bash
# Voice Reply — dry-run regression checks (no audio, no network).
set -uo pipefail
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S="$SKILL_DIR/scripts"
fail=0
ok()   { echo "  ok   $1"; }
bad()  { echo "  FAIL $1"; fail=1; }

# Run under an isolated HOME with a clean config so results don't depend on (or
# pollute) the user's real ~/.voice-reply — e.g. a locked "lang" would otherwise
# skew the language-detection checks.
TESTHOME="$(mktemp -d)"
mkdir -p "$TESTHOME/.voice-reply"
printf '{}' > "$TESTHOME/.voice-reply/hooks.json"
export HOME="$TESTHOME"
trap 'rm -rf "$TESTHOME"' EXIT

echo "1. syntax"
for f in speak opening claude-hook codex-hook codex-notify manage-hooks manage-notify doctor; do
  if node --check "$S/$f.mjs" 2>/dev/null; then ok "$f.mjs"; else bad "$f.mjs"; fi
done
node --check "$SKILL_DIR/adapters/openclaw/handler.js" >/dev/null 2>&1 && ok "adapters/openclaw/handler.js" || bad "adapters/openclaw/handler.js"
node --check "$SKILL_DIR/adapters/hermes/voice-reply-hook.mjs" >/dev/null 2>&1 && ok "adapters/hermes/voice-reply-hook.mjs" || bad "adapters/hermes/voice-reply-hook.mjs"
bash -n "$SKILL_DIR/setup.sh" && ok "setup.sh" || bad "setup.sh"
bash -n "$SKILL_DIR/install.sh" && ok "install.sh" || bad "install.sh"

echo "2. speak.mjs dry-run"
node "$S/speak.mjs" done --dry-run >/dev/null 2>&1 && ok "speak done" || bad "speak done"
node "$S/speak.mjs" play --file /tmp/none.mp3 --dry-run >/dev/null 2>&1 && ok "speak play" || bad "speak play"

echo "3. codex-hook prefers <<voice:>> marker (incl. single-char answer)"
out=$(printf '%s' '{"hook_event_name":"Stop","last_assistant_message":"一堆细节。\n\n<<voice: 对>>"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q '"对"' && ok "single-char marker kept" || bad "single-char marker kept"

echo "3b. codex-hook rejects punctuation-only marker (silent, not spoken literally)"
out=$(printf '%s' '{"hook_event_name":"Stop","last_assistant_message":"改好了，记得重启。\n\n<<voice: ...>>"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q '\.\.\.' && bad "reject punct-only marker" || ok "reject punct-only marker"

echo "4. codex-hook stays silent without marker"
out=$(printf '%s' '{"hook_event_name":"Stop","last_assistant_message":"已完成。修复了参数解析并通过校验。"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && bad "no-marker silence" || ok "no-marker silence"

echo "5. shared opening rule + language detection (opening.mjs)"
# prints "<lang> <key>" for a prompt
oc() { node --input-type=module -e "import {detectLang,openingCue} from '$S/opening.mjs'; const l=detectLang(process.argv[1]); console.log(l, openingCue(process.argv[1], l).key)" "$1"; }
[ "$(oc '帮我改一下')"        = "zh instruction" ] && ok "zh instruction" || bad "zh instruction"
[ "$(oc '这样对吗')"          = "zh question" ]    && ok "zh question"    || bad "zh question"
[ "$(oc '我跟你说个事')"      = "zh other" ]       && ok "zh other"       || bad "zh other"
[ "$(oc 'fix this bug')"      = "en instruction" ] && ok "en instruction" || bad "en instruction"
[ "$(oc 'is this right?')"    = "en question" ]    && ok "en question"    || bad "en question"
[ "$(oc 'just an FYI')"       = "en other" ]       && ok "en other"       || bad "en other"

echo "6. Codex notify fallback (dry-run): speaks the marker on turn-complete"
out=$(VOICE_REPLY_DRY_RUN=1 node "$S/codex-notify.mjs" '{"type":"agent-turn-complete","last-assistant-message":"x\n\n<<voice: 对>>"}' 2>/dev/null)
echo "$out" | grep -q '"对"' && ok "notify marker" || bad "notify marker"

echo "7. Codex notify fallback stays silent without marker"
out=$(VOICE_REPLY_DRY_RUN=1 node "$S/codex-notify.mjs" '{"type":"agent-turn-complete","last-assistant-message":"plain result without marker"}' 2>/dev/null)
echo "$out" | grep -q 'no-marker-silent' && ok "notify no-marker silence" || bad "notify no-marker silence"

echo "8. Hermes adapter dry-run speaks only marker on post_llm_call"
out=$(printf '%s' '{"hook_event_name":"post_llm_call","extra":{"assistant_response":"done\n\n<<voice: 已完成，Hermes 适配可用。>>"}}' \
  | VOICE_REPLY_DRY_RUN=1 node "$SKILL_DIR/adapters/hermes/voice-reply-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'Hermes 适配可用' && ok "hermes marker" || bad "hermes marker"

echo "9. Hermes adapter stays silent without marker"
out=$(printf '%s' '{"hook_event_name":"post_llm_call","extra":{"assistant_response":"plain result without marker"}}' \
  | VOICE_REPLY_DRY_RUN=1 node "$SKILL_DIR/adapters/hermes/voice-reply-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && bad "hermes no-marker silence" || ok "hermes no-marker silence"

echo "10. OpenClaw adapter dry-run speaks marker on message:sent"
out=$(VOICE_REPLY_DRY_RUN=1 node --input-type=module -e "import handler from '$SKILL_DIR/adapters/openclaw/handler.js'; await handler({type:'message', action:'sent', context:{content:'done\\n\\n<<voice: 已完成，OpenClaw 适配可用。>>'}});" 2>/dev/null)
echo "$out" | grep -q 'OpenClaw 适配可用' && ok "openclaw marker" || bad "openclaw marker"

echo
[ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
