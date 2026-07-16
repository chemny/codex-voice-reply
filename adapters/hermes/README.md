# Codex Voice Reply for Hermes

Hermes supports shell-script hooks from `~/.hermes/config.yaml`. This adapter
uses two hook events:

- `pre_llm_call` plays the opening cue.
- `post_llm_call` speaks only the final `<<voice: ...>>` marker.

Example config:

```yaml
hooks:
  pre_llm_call:
    - command: "node ~/.agents/skills/codex-voice-reply/adapters/hermes/voice-reply-hook.mjs"
      timeout: 5
  post_llm_call:
    - command: "node ~/.agents/skills/codex-voice-reply/adapters/hermes/voice-reply-hook.mjs"
      timeout: 10
hooks_auto_accept: true
```

Then verify:

```bash
hermes hooks list
hermes hooks doctor
hermes hooks test pre_llm_call
hermes hooks test post_llm_call --payload-file /path/to/payload.json
```

The adapter is intentionally silent when no valid `<<voice: ...>>` marker is
present, matching the Codex and Claude Code behavior.
