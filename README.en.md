# Voice Reply

[中文](./README.md) | English

Voice Reply gives your coding agent a short **spoken voice** — an instant
acknowledgement the moment you hit enter, and a concise spoken result when it
finishes. It works with **Claude Code** and **Codex**, on macOS / Linux /
Windows, using local [Edge TTS](https://github.com/rany2/edge-tts) playback.

It supports a **type-aware opening cue**, a **model-authored result reply**, and
**per-agent voices**, plus one-command setup, cross-platform playback, and
offline sub-second cues.

## Who Is This For?

This skill is designed for:

- People who run long tasks in Claude Code / Codex and don't want to babysit the screen
- People running multiple agents who want to tell by ear which one finished
- Anyone who wants a voice-feedback layer in their agent workflow

## What It Does

Two spoken moments per turn:

- **Opening cue** — the instant you submit, a hook plays a quick, type-aware
  acknowledgement: a question → *"我看看"*, an instruction → *"好，这就做"*,
  anything unclear → *"收到"*. It fires *before* the model has read your message,
  so it only acknowledges — it never pretends to answer. The cues are
  pre-synthesized and cached, so they play offline in under a second.
- **Result reply** — when the turn finishes, the model's own one-line summary
  (status + key info + next step) is spoken. This is the *real* reply and can
  carry the actual answer (对/错, a fact, "改好了，记得重启").

The intelligence lives in the model, not the script: the model ends each reply
with a `<<voice: ...>>` line, and the hook simply extracts and speaks it. If the
line is missing, a keyword-scoring fallback summarizes the last message.

## Core Capabilities

| Capability | Input | Output |
|---|---|---|
| Instant opening cue | classify the prompt (question / instruction / other) | cached audio, offline, <1s, non-blocking |
| Result reply | model's `<<voice:>>` marker, keyword scoring as fallback | one line: status + key info + next step |
| Per-agent voice | Claude male, Codex female | tell which agent is speaking by ear |
| Shared opening rule | single source in `scripts/opening.mjs` | edit once, both agents update |

## Platform Compatibility

| Platform | Status |
|---|---|
| Claude Code | ✅ Supported (`~/.claude/settings.json` hooks) |
| Codex | ✅ Supported (`~/.codex/hooks.json`) |
| OpenClaw | ⚪ Not tested |

Playback works on macOS (`afplay`) and Linux/Windows (`ffplay` / `mpv` / `mpg123`).

## Install

```bash
git clone https://github.com/chemny/voice-reply ~/.agents/skills/voice-reply
cd ~/.agents/skills/voice-reply
./setup.sh
```

`setup.sh` creates the venv + installs edge-tts, generates the opening cache for
both voices, writes default config into `~/.voice-reply/`, and — **after asking** —
merges hooks into `~/.claude/settings.json` and `~/.codex/hooks.json` (backing
them up first, never clobbering existing hooks). It then prints the marker rule
to add to your agent instructions. Restart your agent session afterwards.

## Quick Start

After install + restart, just send a message:

- Ask a question → hear *"我看看"* immediately, then the conclusion (e.g. *"对"*).
- Give an instruction → hear *"好，这就做"*, then *"改好了，记得重启"* when done.

Manual check (no hooks needed):

```bash
node scripts/speak.mjs done
./test.sh        # dry-run regression checks (no audio, no network)
```

## Usage Examples

```bash
# Speak a line
node scripts/speak.mjs text --text "改好了，记得重启。" --full

# Play an existing audio file (cross-platform player)
node scripts/speak.mjs play --file ~/.voice-reply/cache/opening-question-zh-CN-YunxiNeural.mp3

# Preview the spoken text and dependency status without audio
node scripts/speak.mjs summary --text "修复了参数解析并通过校验。" --dry-run
```

The result marker the model writes each turn looks like:

```text
<<voice: 改好了，记得重启会话生效>>
```

## How It Works

| Moment | Who decides what to say | What you hear |
|---|---|---|
| You submit | hook classifies the prompt (`scripts/opening.mjs`, shared) | 我看看 / 好，这就做 / 收到 |
| Agent finishes | the **model** writes `<<voice: …>>` | the real result; keyword scoring as fallback |

The hook scripts only play audio. Playback is fired in the background so hooks
return in ~200 ms and never block the agent. Spoken text is hard-capped at 60 chars.

## Repository Structure

```text
voice-reply/
├── scripts/
│   ├── speak.mjs        # core: text → Edge TTS mp3 → cross-platform player
│   ├── opening.mjs      # shared opening-cue rule (both agents)
│   ├── claude-hook.mjs  # Claude Code hook entry
│   ├── codex-hook.mjs   # Codex hook entry
│   ├── codex-notify.mjs # Codex notify fallback
│   └── manage-hooks.mjs # idempotent install/remove hooks (with backup)
├── setup.sh / uninstall.sh / test.sh
├── SKILL.md / README.md / README.en.md / LICENSE / .gitignore
└── agents/openai.yaml
```

Runtime data lives in `~/.voice-reply/`: `config.json` (voice/rate/volume),
`hooks.json` (toggles and fixed texts), `cache/` (opening cues).

## Requirements

- Node 18+
- Python 3 (runs edge-tts in a local venv)
- An audio player: `afplay` on macOS, or `ffplay` / `mpv` / `mpg123` on Linux/Windows
- Network access ([edge-tts](https://github.com/rany2/edge-tts) uses Microsoft's endpoint)

The opening classifier and default phrases are **Chinese**; edit the regexes and
phrases in `scripts/opening.mjs` for other languages.

## License

[MIT](LICENSE)
