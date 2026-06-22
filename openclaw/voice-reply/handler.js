// Voice Reply — OpenClaw internal hook handler.
//
// Mirrors the Claude/Codex adapters: the shared rule (scripts/opening.mjs) and
// playback (scripts/speak.mjs) are reused; this file only maps OpenClaw's event
// shape onto them. It plays a type-aware opening cue when a prompt arrives and
// speaks the model's <<voice:>> marker when a turn completes.
//
// Because the per-surface event names are not fully documented, this version
// logs every received event to ~/.voice-reply/openclaw-hook.log and only acts
// on the documented content-bearing events (message:received / message:sent).
// Read the log after a live turn to confirm and narrow the subscription.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { promptText, playOpening, extractVoiceMarker } from "../../scripts/opening.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const speakScript = join(__dirname, "..", "..", "scripts", "speak.mjs");
const LOG = join(homedir(), ".voice-reply", "openclaw-hook.log");

// OpenClaw's own voice (distinct from Claude male / Codex female). Change here.
const OPENCLAW_VOICE = "zh-CN-YunyangNeural";

// Events we actually speak on. Others are logged only (diagnostic), to avoid
// double-playing while we confirm which events this surface fires.
const SUBMIT_EVENTS = new Set(["message:received"]);
const DONE_EVENTS = new Set(["message:sent"]);

function log(obj) {
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n");
  } catch {
    // logging must never break a hook
  }
}

function speakDetached(text) {
  try {
    const child = spawn(process.execPath, [speakScript, "text", "--text", text, "--full"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, VOICE_REPLY_VOICE: OPENCLAW_VOICE },
    });
    child.unref();
  } catch {
    // ignore
  }
}

const handler = async (event) => {
  try {
    const type = event?.type ?? "";
    const action = event?.action ?? "";
    const name = action ? `${type}:${action}` : type;
    const ctx = event?.context ?? {};
    log({ name, contextKeys: Object.keys(ctx) });

    if (SUBMIT_EVENTS.has(name)) {
      const text = promptText(ctx) || promptText(event);
      const cue = playOpening({ content: text }, OPENCLAW_VOICE);
      log({ name, did: "open", cue: cue.key, hasText: Boolean(text) });
      return;
    }

    if (DONE_EVENTS.has(name)) {
      const reply = ctx.content || ctx.text || event?.content || "";
      const marker = extractVoiceMarker(reply);
      if (marker) {
        speakDetached(marker);
        log({ name, did: "marker" });
      } else {
        log({ name, did: "no-marker", hasReply: Boolean(reply) });
      }
      return;
    }
  } catch (error) {
    log({ error: String((error && error.message) || error) });
  }
};

export default handler;
