---
name: codex-voice-reply
description: "Speak a short, context-aware voice reply for agent work — an instant acknowledgement when the user submits, and a decision-first spoken result when the turn finishes (it leads with the choice the user must make, turning a one-way announcement into a back-and-forth). Chinese + English: you pick a language at setup and it locks (or choose auto, which follows each message). Works for Claude Code and Codex via hooks, with experimental OpenClaw and Hermes adapters, using local Edge TTS playback. Use when adding spoken acknowledgements/announcements, reading a result aloud, or wiring voice notifications into an agent workflow."
metadata:
  version: "1.1.0"
---

# Codex Voice Reply

## Overview

Codex Voice Reply gives a coding agent a short spoken voice:

- **Opening cue** — the instant the user submits, a hook plays a quick acknowledgement matched to the message's language and type (zh: 我看看 / 好，这就做 / 收到; en: Let me look / On it / Got it). It fires before the model has read the message, so it can only acknowledge, never answer.
- **Result reply** — when the turn finishes, the model's own one-line summary is spoken: a conclusion, or **the decision the user must make (decision-first)** so they can answer and keep the loop going. It can contain the actual answer (对/错, a fact, "改好了，记得重启"), in a voice matched to the reply's language.

Playback is local Edge TTS + `afplay`, fired in the background so hooks return in ~200ms and never block the agent.

## Layout

```
codex-voice-reply/
  SKILL.md
  install.sh           # one-command bootstrap installer
  setup.sh             # one-command install (venv, cache, hooks)
  uninstall.sh         # remove hooks, restore backups
  uninstall.ps1        # Windows-safe uninstall; optionally archive runtime data
  test.sh              # dry-run regression checks
  scripts/
    speak.mjs          # core: text → Edge TTS mp3 → cross-platform player
    opening.mjs        # shared opening-cue rule (classifier + cached playback)
    claude-hook.mjs    # Claude Code hook entry (opening + result marker only)
    codex-hook.mjs     # Codex hook entry (opening + result marker only)
    codex-notify.mjs   # Codex `notify` fallback for builds without hooks (completion-only)
    manage-hooks.mjs   # register/remove hooks in settings.json / hooks.json
    manage-notify.mjs  # wire/unwire the Codex notify fallback in config.toml
    doctor.mjs         # self-check: node/edge-tts/player/config/cache/hooks
  adapters/
    openclaw/           # OpenClaw hook adapter (experimental)
    hermes/             # Hermes shell-hook adapter (experimental)
  agents/openai.yaml
  .venv/               # created by setup.sh, gitignored
```

Config + cache live in `~/.voice-reply/`:

```
~/.voice-reply/
  config.json   # voice / rate / volume (read by speak.mjs)
  hooks.json    # toggles + fixed texts (read by codex-hook.mjs)
  cache/        # pre-synthesized opening cue mp3s, named opening-<type>-<voice>.mp3
  hook.log      # hook decisions and suppression reasons
  playback.log  # synthesis/cache/player start, success, and failure events
```

Both runtime logs rotate at 5 MB and keep up to three backups.

## Manual playback

Run from the skill directory (`$SKILL` = wherever this skill is installed):

```bash
node "$SKILL/scripts/speak.mjs" done
node "$SKILL/scripts/speak.mjs" text --text "改好了，记得重启。" --full
node "$SKILL/scripts/speak.mjs" summary --text "修复了参数解析并通过校验。"
node "$SKILL/scripts/speak.mjs" play --file <file.mp3>   # play an existing clip (cross-platform)
```

`speak.mjs` resolves Edge TTS from the project `.venv` (created by `setup.sh`) if `edge-tts` is not on PATH, and auto-detects a player (`afplay`/`ffplay`/`mpv`/`mpg123`). Use `--dry-run` to preview text and dependency status without audio. Voice/rate/volume can be overridden by `--voice/--rate/--volume`, by env vars `VOICE_REPLY_VOICE/RATE/VOLUME`, or by `~/.voice-reply/config.json`.

## Automatic hooks

**Current Codex policy:** opening and completion use two separate gates.
`UserPromptSubmit` controls the opening cue through root/sub-agent detection plus
a short debounce; no voice marker exists yet at that point. Completion playback
is marker-only: `<<voice: one-sentence result and next action>>` is an explicit
authorization to speak directly to the user, not a generic completion summary.
Only the root agent may issue it after aggregating required worker results.
Stop events without a marker stay silent, including intermediate lists,
structured payloads, tests, tool output, sub-agent results, and recognized
background memory-maintenance turns.

In multi-agent runs, only the root agent may emit the marker. Tasks dispatched
to sub-agents are prefixed with `[voice-silent-subagent]`; the Codex hook keeps
those prompt and Stop events silent, while a short opening debounce suppresses
bursty duplicate starts. The root agent aggregates all worker results and speaks
once. If future Codex hook payloads expose parent/role metadata, the same filter
uses those fields automatically.

**Claude Code** — `~/.claude/settings.json` registers `claude-hook.mjs` on `UserPromptSubmit` (opening cue) and `Stop` (result reply). On Stop it reads the transcript, extracts the last hidden `<!-- voice: ... -->` marker the model wrote, and speaks it. If absent, it stays silent. Legacy `<<voice: ...>>` markers remain supported.

**Codex** — `~/.codex/hooks.json` registers `codex-hook.mjs` on the same events. Codex provides `last_assistant_message` directly. In the default `marker` mode, the hook speaks only the final voice marker; without one it stays silent. Root/sub-agent filtering runs first as a safety net, so a clearly identified worker remains silent even if it emits a marker by mistake.

**Codex without hooks support** (older / some Windows builds) — fall back to Codex's `notify` mechanism: `node scripts/manage-notify.mjs add "$(pwd)"` points `notify` in `~/.codex/config.toml` at `codex-notify.mjs` (preserving and chaining any existing notify program). This speaks the hidden voice marker on turn completion only — there is no opening cue via notify.

**OpenClaw** — experimental adapter in `adapters/openclaw`. It treats `message:received` as the opening event and `message:sent` as the result event, then reuses the same shared opening and marker extraction rules.

**Hermes** — experimental adapter in `adapters/hermes`. Configure it as a Hermes shell hook: `pre_llm_call` plays the opening cue, and `post_llm_call` speaks only the final hidden voice marker.

The model authorizes a completion reply by writing one final marker:

```
<!-- voice: status + core info + next action -->
```

Codex also supports the visible `<<voice: ...>>` form required by its agent
instructions. The marker should lead with any decision or next action. All
supported runtimes stay silent when no marker is present; there is no automatic
sentence-selection fallback. Spoken audio is clamped to ≤60 characters.

## Per-agent voice

Claude Code speaks **male** and Codex speaks **female**, so you can tell them apart by ear. Each has a Chinese and an English voice, picked automatically by the message/reply language: Claude `CLAUDE_VOICE_ZH` / `CLAUDE_VOICE_EN` at the top of `claude-hook.mjs` (default zh-CN-YunxiNeural / en-US-GuyNeural); Codex `voice` / `voiceEn` in `~/.voice-reply/config.json` (default zh-CN-XiaoxiaoNeural / en-US-AriaNeural).

## Opening cue

The opening rule lives in `scripts/opening.mjs` and is **shared by both agents and
both languages**. `setup.sh` asks the user to pick a language on first install and
writes it as `"lang": "zh"|"en"` in `~/.voice-reply/hooks.json` (an opening-only
lock). When `lang` is set, that language is used for openings; remove it to
auto-detect each message (CJK → Chinese, else English). Result voice selection
is independent and defaults to `"resultLang": "auto"`, following the actual
voice-marker text. It then classifies the message
(question / instruction / other) and plays the matching phrase in that agent's
voice for that language. Chinese: 我看看 / 好，这就做 / 收到. English: Let me look /
On it / Got it. Edit the language packs once and both Claude and Codex pick it up.

The phrases are pre-synthesized to `~/.voice-reply/cache/opening-<type>-<voice>.mp3`
so the opening plays instantly and offline (live synthesis would add ~5s). The
filename includes the voice, so changing a voice never replays the old one — it
falls back to live synthesis in the new voice until you re-run `setup.sh` to
refresh the cache.

## Dependency

`speak.mjs` needs `edge-tts` (installed into `.venv` by `setup.sh`, or on PATH) and an audio player: `afplay` on macOS, or `ffplay`/`mpv`/`mpg123` on Linux/Windows. Edge TTS requires network access (Microsoft endpoint). Run `setup.sh` to install everything; it asks before changing your hook configs.

## Troubleshooting (no sound)

Run `node scripts/doctor.mjs` — it checks every link (node, edge-tts/venv, audio player, config, cache, hook registration) and prints what to fix. Common causes: the agent wasn't restarted after install (hooks load at session start); no audio player on Linux/Windows (install ffplay/mpv/mpg123); hooks unregistered or the command path got quoted (re-run `setup.sh` to rewrite it unquoted); edge-tts not installed. The hook command must be unquoted (`node /path/...`) — a quoted path is taken literally by some hook runners and fails silently. `setup.sh` ends by running the doctor and playing a test sound.
