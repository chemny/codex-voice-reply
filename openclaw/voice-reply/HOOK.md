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
speaks the model's `<<voice: …>>` result marker when a turn completes. It reuses
the shared `scripts/opening.mjs` rule and `scripts/speak.mjs` playback, in
OpenClaw's own voice.

This first version subscribes to several candidate events and writes a
diagnostic line per event to `~/.voice-reply/openclaw-hook.log`, so the exact
submit/completion events for this surface can be confirmed and the subscription
narrowed.

Enable with:

```bash
openclaw hooks enable voice-reply
```
