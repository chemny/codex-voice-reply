---
name: voice-reply
description: "Speak a short voice reply on prompt submit and turn completion."
metadata:
  {
    "openclaw":
      {
        "emoji": "🔊",
        "events":
          [
            "message:received",
            "message:sent",
            "prompt:before",
            "session:after",
            "run:completed",
          ],
        "requires": { "bins": ["node"] },
        "os": ["darwin", "linux"],
      },
  }
---

# Voice Reply (OpenClaw hook)

Plays a quick, type-aware spoken acknowledgement when a prompt arrives, and
speaks the model's `<<voice: ...>>` result marker when a turn completes. It
reuses the shared `scripts/opening.mjs` rule and `scripts/speak.mjs` playback,
in OpenClaw's own voice.

This adapter currently treats `message:received` as the opening event and
`message:sent` as the completion event. Other candidate events are subscribed
for diagnostics only and are written to `~/.voice-reply/openclaw-hook.log`.

Enable with:

```bash
openclaw hooks enable voice-reply
```
