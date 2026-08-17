#!/usr/bin/env bash
# Codex Voice Reply — dry-run regression checks (no audio, no network).
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
export VOICE_REPLY_HOME="$TESTHOME/.voice-reply"
trap 'rm -rf "$TESTHOME"' EXIT

echo "1. syntax"
for f in speak opening claude-hook codex-hook codex-notify manage-hooks manage-notify doctor; do
  if node --check "$S/$f.mjs" 2>/dev/null; then ok "$f.mjs"; else bad "$f.mjs"; fi
done
node --check "$SKILL_DIR/adapters/openclaw/handler.js" >/dev/null 2>&1 && ok "adapters/openclaw/handler.js" || bad "adapters/openclaw/handler.js"
node --check "$SKILL_DIR/adapters/hermes/voice-reply-hook.mjs" >/dev/null 2>&1 && ok "adapters/hermes/voice-reply-hook.mjs" || bad "adapters/hermes/voice-reply-hook.mjs"
bash -n "$SKILL_DIR/setup.sh" && ok "setup.sh" || bad "setup.sh"
bash -n "$SKILL_DIR/install.sh" && ok "install.sh" || bad "install.sh"
bash -n "$SKILL_DIR/uninstall.sh" && ok "uninstall.sh" || bad "uninstall.sh"

echo "2. speak.mjs dry-run"
node "$S/speak.mjs" done --dry-run >/dev/null 2>&1 && ok "speak done" || bad "speak done"
node "$S/speak.mjs" play --file /tmp/none.mp3 --dry-run >/dev/null 2>&1 && ok "speak play" || bad "speak play"

echo "3. codex-hook prefers <<voice:>> marker (incl. single-char answer)"
out=$(printf '%s' '{"hook_event_name":"Stop","last_assistant_message":"一堆细节。\n\n<<voice: 对>>"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q '"对"' && ok "single-char marker kept" || bad "single-char marker kept"

echo "3a. codex-hook supports hidden HTML marker"
out=$(printf '%s' '{"hook_event_name":"Stop","last_assistant_message":"完成。\n\n<!-- voice: 隐藏播报可用 -->"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q '隐藏播报可用' && ok "hidden marker kept" || bad "hidden marker kept"

echo "3b. codex-hook rejects punctuation-only marker (silent, not spoken literally)"
out=$(printf '%s' '{"hook_event_name":"Stop","last_assistant_message":"改好了，记得重启。\n\n<<voice: ...>>"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q '\.\.\.' && bad "reject punct-only marker" || ok "reject punct-only marker"

echo "4. codex-hook stays silent without a final voice marker"
out=$(printf '%s' '{"hook_event_name":"Stop","last_assistant_message":"已完成。修复了参数解析并通过校验。"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && bad "plain result silent" || ok "plain result silent"

echo "4a. outcome and decision text without marker stay silent"
out=$(printf '%s' '{"hook_event_name":"Stop","last_assistant_message":"已完成。修复了 Windows 弹窗问题，并通过全部测试。"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && bad "outcome without marker silent" || ok "outcome without marker silent"
out=$(printf '%s' '{"hook_event_name":"Stop","last_assistant_message":"需要你确认：现在是否继续推送到 GitHub？确认后我会创建提交。"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && bad "decision without marker silent" || ok "decision without marker silent"

echo "4b. codex-hook keeps list/structured/intermediate results silent"
out=$(printf '%s' '{"hook_event_name":"Stop","session_id":"s1","turn_id":"t1","last_assistant_message":"{\"keywords\":[{\"en\":\"theatre\",\"cn\":\"n. 剧院\"}]}"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && bad "structured result silent" || ok "structured result silent"
out=$(printf '%s' '{"hook_event_name":"Stop","session_id":"s1","turn_id":"t-list","last_assistant_message":"- 已修复结束播报\n- 已通过回归测试"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && bad "list result silent" || ok "list result silent"
out=$(printf '%s' '{"hook_event_name":"Stop","session_id":"s1","turn_id":"t2","last_assistant_message":"相关文件"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && bad "section label silent" || ok "section label silent"
out=$(printf '%s' '{"hook_event_name":"Stop","session_id":"s1","turn_id":"t3","last_assistant_message":"第二轮再做一次教师验收。"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && bad "weak intermediate silent" || ok "weak intermediate silent"

echo "4c. visible final voice line is spoken exactly once"
out=$(printf '%s' '{"hook_event_name":"Stop","session_id":"s1","turn_id":"t-final","last_assistant_message":"修复完成。\n\n<<voice: 已修复结束播报，中间阶段不会再发声。>>"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
[ "$(echo "$out" | grep -c 'announceArgs')" = "1" ] && echo "$out" | grep -q '已修复结束播报，中间阶段不会再发声' && ok "visible final voice once" || bad "visible final voice once"

echo "4d. multi-agent events stay silent"
out=$(printf '%s' '{"hook_event_name":"UserPromptSubmit","session_id":"child-1","prompt":"[voice-silent-subagent] 审查实现"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'opening' && bad "sub-agent opening silent" || ok "sub-agent opening silent"
out=$(printf '%s' '{"hook_event_name":"Stop","session_id":"child-1","agent_role":"subagent","last_assistant_message":"完成。\n\n<<voice: 子任务已完成。>>"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && bad "sub-agent marker silent" || ok "sub-agent marker silent"

echo "4e. bursty opening events are deduplicated"
rm -f "$VOICE_REPLY_HOME/opening-state.json"
first=$(printf '%s' '{"hook_event_name":"UserPromptSubmit","session_id":"root-1","prompt":"帮我处理任务"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
second=$(printf '%s' '{"hook_event_name":"UserPromptSubmit","session_id":"unknown-2","prompt":"并行处理任务"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$first" | grep -q 'opening' && ! echo "$second" | grep -q 'opening' && ok "opening burst dedup" || bad "opening burst dedup"

echo "4f. transcript owner mismatch is treated as a sub-agent"
out=$(printf '%s' '{"hook_event_name":"Stop","session_id":"22222222-2222-2222-2222-222222222222","transcript_path":"/tmp/rollout-11111111-1111-1111-1111-111111111111.jsonl","last_assistant_message":"<<voice: 不应播报。>>"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && bad "transcript owner mismatch silent" || ok "transcript owner mismatch silent"

echo "4g. result voice follows content, not locked opening language"
printf '{"lang":"zh"}' > "$VOICE_REPLY_HOME/hooks.json"
out=$(printf '%s' '{"hook_event_name":"Stop","session_id":"33333333-3333-3333-3333-333333333333","transcript_path":"/tmp/rollout-33333333-3333-3333-3333-333333333333.jsonl","last_assistant_message":"<<voice: English result is ready.>>"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'en-US-AriaNeural' && ok "English result uses English voice" || bad "English result uses English voice"
printf '{}' > "$VOICE_REPLY_HOME/hooks.json"

echo "5. shared opening rule + language detection (opening.mjs)"
# prints "<lang> <key>" for a prompt
oc() { node --input-type=module -e "import {pathToFileURL} from 'node:url'; const m=await import(pathToFileURL(process.argv[1])); const l=m.detectLang(process.argv[2]); console.log(l, m.openingCue(process.argv[2], l).key)" "$S/opening.mjs" "$1"; }
[ "$(oc '帮我改一下')"        = "zh instruction" ] && ok "zh instruction" || bad "zh instruction"
[ "$(oc '这样对吗')"          = "zh question" ]    && ok "zh question"    || bad "zh question"
[ "$(oc '现在几点')"          = "zh question" ]    && ok "zh question: 几点" || bad "zh question: 几点"
[ "$(oc '大概要多久')"        = "zh question" ]    && ok "zh question: 多久" || bad "zh question: 多久"
[ "$(oc '这样行不行')"        = "zh question" ]    && ok "zh question: 行不行" || bad "zh question: 行不行"
[ "$(oc '有没有结果')"        = "zh question" ]    && ok "zh question: 有没有" || bad "zh question: 有没有"
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

echo "9a. Hermes English result uses English voice despite Chinese opening lock"
printf '{"lang":"zh"}' > "$VOICE_REPLY_HOME/hooks.json"
out=$(printf '%s' '{"hook_event_name":"post_llm_call","extra":{"assistant_response":"<<voice: English result ready.>>"}}' \
  | VOICE_REPLY_DRY_RUN=1 node "$SKILL_DIR/adapters/hermes/voice-reply-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'en-US-ChristopherNeural' && ok "hermes English voice" || bad "hermes English voice"
printf '{}' > "$VOICE_REPLY_HOME/hooks.json"

echo "10. OpenClaw adapter dry-run speaks marker on message:sent"
out=$(VOICE_REPLY_DRY_RUN=1 node --input-type=module -e "import {pathToFileURL} from 'node:url'; const {default:handler}=await import(pathToFileURL(process.argv[1])); await handler({type:'message', action:'sent', context:{content:'done\\n\\n<<voice: 已完成，OpenClaw 适配可用。>>'}});" "$SKILL_DIR/adapters/openclaw/handler.js" 2>/dev/null)
echo "$out" | grep -q 'OpenClaw 适配可用' && ok "openclaw marker" || bad "openclaw marker"

echo "10a. OpenClaw English result uses English voice"
out=$(VOICE_REPLY_DRY_RUN=1 node --input-type=module -e "import {pathToFileURL} from 'node:url'; const {default:handler}=await import(pathToFileURL(process.argv[1])); await handler({type:'message', action:'sent', context:{content:'<<voice: English result ready.>>'}});" "$SKILL_DIR/adapters/openclaw/handler.js" 2>/dev/null)
echo "$out" | grep -q 'en-US-EricNeural' && ok "openclaw English voice" || bad "openclaw English voice"

echo "10b. Codex background maintenance opening stays silent"
out=$(printf '%s' '{"hook_event_name":"UserPromptSubmit","prompt":"Consolidation complete."}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/codex-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && bad "maintenance opening silent" || ok "maintenance opening silent"

echo "11. Claude sub-agent is silent and English result uses English voice"
out=$(printf '%s' '{"hook_event_name":"SubagentStop","transcript_path":"/tmp/none.jsonl"}' \
  | VOICE_REPLY_DRY_RUN=1 node "$S/claude-hook.mjs" 2>/dev/null)
echo "$out" | grep -q 'announceArgs' && bad "claude sub-agent silent" || ok "claude sub-agent silent"
voice=$(node --input-type=module -e "import {pathToFileURL} from 'node:url'; const m=await import(pathToFileURL(process.argv[1])); console.log(m.detectContentLang('English result ready.'));" "$S/opening.mjs")
[ "$voice" = "en" ] && ok "claude shared English detection" || bad "claude shared English detection"

echo
[ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
