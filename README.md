# Codex Voice Reply

English | [中文](./README.zh.md)

**Talk with your agent by voice — stop watching the screen.**

Codex Voice Reply makes your coding agent more than a one-way announcer: it answers the
moment you speak, and when it finishes a step it tells you the **decision it needs
from you**. You reply, it continues — a back-and-forth, so your eyes are free but
you stay in control.

Works with **Claude Code** and **Codex**, with experimental adapters for
**OpenClaw** and **Hermes**, **Chinese and English (pick one at setup,
locked; or choose auto-per-message)**, with an instant opening cue, a decision-first result reply,
per-agent voices, one-command setup, cross-platform playback (macOS / Linux /
Windows), and offline cues via local [Edge TTS](https://github.com/rany2/edge-tts).

## Who Is This For?

This skill is designed for:

- People who run long tasks in Claude Code / Codex and don't want to babysit the screen
- People running multiple agents who want to tell by ear which one finished
- Anyone who wants a voice-feedback layer in their agent workflow

## What It Does

Two spoken moments per turn:

- **Opening cue** — the instant you submit, a hook plays a quick acknowledgement
  matched to your message's **language and type**. It fires *before* the model
  reads your message, so it only acknowledges — never pretends to answer.
  Pre-synthesized and cached, so it plays offline in under a second.
- **Result reply** — when the turn finishes, the model's one-line reply is spoken:
  a conclusion, **or the decision it needs from you (decision-first)**. You answer
  and the loop continues — turning a one-way announcement into a back-and-forth. It
  can carry the real answer (yes/no, a number, "restart to apply"), in a voice matched
  to the reply's language.

Codex summarizes the final answer locally, so normal turns need no extra model
instruction or output marker. An optional hidden `<!-- voice: ... -->` marker can
override the local summary for an exact decision-first phrase. Legacy
`<<voice: ...>>` markers remain supported.

## Core Capabilities

| Capability | What It Helps You Do |
|---|---|
| Instant opening cue | Hear immediately that the agent has received the task and started working. |
| Final voice reply | Speak only the final `voice` marker, so long answers or intermediate status do not get read aloud. |
| Decision-first reminder | When the result needs approval, a choice, or a next step, hear that action first. |
| Chinese + English voice | Use fixed Chinese, fixed English, or automatic language switching per message. |
| Per-agent voice identity | Give Claude Code and Codex different voices so parallel agents are easy to tell apart. |

## Platform Compatibility

| Platform | Status |
|---|---|
| Claude Code | ✅ Supported (`~/.claude/settings.json` hooks) |
| Codex | ✅ Supported (`~/.codex/hooks.json`) |
| OpenClaw | 🧪 Experimental (`adapters/openclaw`) |
| Hermes | 🧪 Experimental (`adapters/hermes`, `~/.hermes/config.yaml` shell hooks) |

Playback works on macOS (`afplay`) and Linux/Windows (`ffplay` / `mpv` / `mpg123`).

## Install

macOS / Linux:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/chemny/codex-voice-reply/main/install.sh)"
```

The installer guides the full setup: repository checkout, Python environment,
Edge TTS, voice cache, Claude Code / Codex hooks, result-marker instructions, and
a final sound test. Restart the agent session after it finishes.

Codex requires one-time approval for installed hooks. After setup, run `/hooks`
in Codex and approve both `UserPromptSubmit` and `Stop`, then start a new task.
The installer prints and speaks this reminder; `doctor.mjs` reports either
`approval required` or `approval record found` for each hook.

The default install location is `~/.agents/skills/codex-voice-reply`. Set
`VOICE_REPLY_INSTALL_DIR` before running the installer if you want a different
folder.

## Windows Installation

Run the PowerShell installer:

```powershell
irm https://raw.githubusercontent.com/chemny/codex-voice-reply/main/install.ps1 | iex
```

## Quick Start

After install + restart, just send a message:

- Ask a question → hear *"我看看"* immediately, then the conclusion (e.g. *"对"*).
- Give an instruction → hear *"好，这就做"*, then *"改好了，记得重启"* when done.

The installer finishes with an audible test and a self-check report.

## Usage Examples

Result speech normally comes from Codex's local, privacy-filtered sentence selector.
An optional hidden `<!-- voice: ... -->` marker can override it with an exact phrase.
Legacy `<<voice: ...>>` markers remain supported.

## How It Works

| Moment | Who decides what to say | What you hear |
|---|---|---|
| You submit | hook classifies the prompt (`scripts/opening.mjs`, shared) | 我看看 / 好，这就做 / 收到 |
| Agent finishes | the **model** writes `<!-- voice: … -->` | the real result; silent when missing |

The hook scripts only play audio. Playback is fired in the background so hooks
return in ~200 ms and never block the agent. Spoken text is hard-capped at 60 chars.

## Repository Structure

```text
codex-voice-reply/
├── scripts/
│   ├── speak.mjs        # core: text → Edge TTS mp3 → cross-platform player
│   ├── opening.mjs      # shared opening-cue rule (both agents)
│   ├── claude-hook.mjs  # Claude Code hook entry
│   ├── codex-hook.mjs   # Codex hook entry
│   ├── codex-notify.mjs # Codex notify fallback
│   └── manage-hooks.mjs # idempotent install/remove hooks (with backup)
├── adapters/
│   ├── openclaw/        # OpenClaw hook adapter
│   └── hermes/          # Hermes shell-hook adapter
├── install.sh / setup.sh / uninstall.sh / test.sh
├── SKILL.md / README.md / README.zh.md / LICENSE / .gitignore
└── agents/openai.yaml
```

Runtime data lives in `~/.voice-reply/`: `config.json` (voice/rate/volume),
`hooks.json` (toggles and fixed texts), `cache/` (opening cues).

## Requirements

- Node 18+
- Python 3 (runs edge-tts in a local venv)
- An audio player: `afplay` on macOS, or `ffplay` / `mpv` / `mpg123` on Linux/Windows
- Network access ([edge-tts](https://github.com/rany2/edge-tts) uses Microsoft's endpoint)

Ships with **Chinese + English** opening phrases and classifiers. During install
you can choose Chinese, English, or auto per-message switching. More languages
can be added by extending the packs in `scripts/opening.mjs`.

## No sound?

Run the doctor first — it pinpoints which link in the chain is broken:

```bash
node scripts/doctor.mjs
```

Common causes:

- **Didn't restart the agent** — hooks load at session start, so restart Claude Code / Codex after install.
- **No audio player** (Linux/Windows) — install `ffplay` (ffmpeg), `mpv`, or `mpg123`; macOS ships `afplay`.
- **Hooks not registered, or the command path got quoted** — rerun the one-command installer; it rewrites the hook in the correct form.
- **This Codex build has no hooks support** (older / some Windows CLIs) — use the `notify` fallback: `node scripts/manage-notify.mjs add "$(pwd)"`, then restart Codex. It takes over Codex's `notify` (preserving and chaining your existing one) and speaks the voice marker on **completion only — no opening cue**.
- **edge-tts not installed** — rerun the one-command installer (needs python3 + network).

## Experimental Adapters

OpenClaw and Hermes adapters reuse the same shared rules as Claude Code and
Codex:

- opening cue: classify the user's prompt and speak a short acknowledgement;
- result reply: locally select the conclusion or decision sentence;
- optional hidden marker: override the local selection with an exact phrase.

OpenClaw files live in `adapters/openclaw`. Hermes files live in
`adapters/hermes`; its hook command is configured through `~/.hermes/config.yaml`.
Both adapters are marked experimental until their event payloads are validated
across more installs.

The install flow ends by running the doctor and playing a test sound. If you hear
it, audio works.

## License

[Apache License 2.0](LICENSE)
