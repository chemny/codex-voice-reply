// Codex Voice Reply — OpenClaw hook handler.
//
// Mirrors the Claude/Codex adapters: shared opening rules and playback live in
// scripts/. This file only maps OpenClaw's event shape onto them.
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { appendRotatingLog, promptText, playOpening, extractVoiceMarker, clampSpoken, detectContentLang, resolveVoice } from "../../scripts/opening.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const speakScript = join(__dirname, "..", "..", "scripts", "speak.mjs");
const LOG = join(homedir(), ".voice-reply", "openclaw-hook.log");

// OpenClaw voice, distinct from Claude male / Codex female defaults.
const OPENCLAW_VOICES = {
  zh: "zh-CN-YunyangNeural",
  en: "en-US-EricNeural",
};
const MAX_RESULT_CHARS = 60;
const NO_MARKER_FALLBACK = "已完成。";

const SUBMIT_EVENTS = new Set(["message:received"]);
const DONE_EVENTS = new Set(["message:sent"]);

function log(obj) {
  appendRotatingLog(LOG, obj);
}

function isUsefulVoiceText(text) {
  const t = String(text || "");
  return /[\u4e00-\u9fff]/.test(t) || /[A-Za-z0-9]/.test(t);
}

function speakDetached(text) {
  const spoken = clampSpoken(text, MAX_RESULT_CHARS);
  const voice = resolveVoice(OPENCLAW_VOICES, detectContentLang(spoken));
  if (process.env.VOICE_REPLY_DRY_RUN === "1") {
    process.stdout.write(JSON.stringify({ announceArgs: ["text", "--text", spoken, "--full"], voice }, null, 2) + "\n");
    return;
  }
  try {
    const child = spawn(process.execPath, [speakScript, "text", "--text", spoken, "--full"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, VOICE_REPLY_VOICE: voice },
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
      const cue = playOpening({ content: text }, OPENCLAW_VOICES);
      log({ name, did: "open", cue: cue.key, hasText: Boolean(text) });
      return;
    }

    if (DONE_EVENTS.has(name)) {
      const reply = ctx.content || ctx.text || event?.content || "";
      const marker = extractVoiceMarker(reply);
      if (isUsefulVoiceText(marker)) {
        speakDetached(marker);
        log({ name, did: "marker" });
      } else {
        speakDetached(NO_MARKER_FALLBACK);
        log({ name, did: "no-marker-fallback", hasReply: Boolean(reply) });
      }
    }
  } catch (error) {
    log({ error: String((error && error.message) || error) });
  }
};

export default handler;
