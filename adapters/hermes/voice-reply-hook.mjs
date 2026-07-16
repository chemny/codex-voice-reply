#!/usr/bin/env node
// Codex Voice Reply — Hermes shell-hook adapter.
//
// Intended for ~/.hermes/config.yaml hooks:
//   pre_llm_call  -> opening cue
//   post_llm_call -> final <<voice: ...>> result marker
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { detectLang, extractVoiceMarker, playOpening, resolveVoice, clampSpoken } from "../../scripts/opening.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const speakScript = join(__dirname, "..", "..", "scripts", "speak.mjs");
const LOG = join(homedir(), ".voice-reply", "hermes-hook.log");
const MAX_RESULT_CHARS = 60;

const HERMES_VOICES = {
  zh: process.env.VOICE_REPLY_HERMES_VOICE_ZH || "zh-CN-YunjianNeural",
  en: process.env.VOICE_REPLY_HERMES_VOICE_EN || "en-US-ChristopherNeural",
};

function log(obj) {
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n");
  } catch {
    // Logging must never break a hook.
  }
}

function readStdinJson() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return {};
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function messageText(message) {
  if (!message) return "";
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.map(messageText).filter(Boolean).join("\n");
  if (typeof message !== "object") return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(messageText).filter(Boolean).join("\n");
  if (typeof message.text === "string") return message.text;
  return "";
}

function latestAssistantText(payload) {
  const extra = payload.extra || {};
  const messages = Array.isArray(extra.conversation_history)
    ? extra.conversation_history
    : Array.isArray(extra.messages)
      ? extra.messages
      : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "assistant") {
      const text = messageText(messages[i]);
      if (text) return text;
    }
  }
  return firstString(
    extra.assistant_response,
    extra.response_text,
    extra.response,
    extra.output_text,
    extra.final_response,
    extra.assistant_message,
    payload.response_text,
    payload.response,
  );
}

function latestUserText(payload) {
  const extra = payload.extra || {};
  const messages = Array.isArray(extra.conversation_history)
    ? extra.conversation_history
    : Array.isArray(extra.messages)
      ? extra.messages
      : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      const text = messageText(messages[i]);
      if (text) return text;
    }
  }
  return firstString(extra.user_message, extra.prompt, extra.input, payload.user_message, payload.prompt);
}

function isUsefulVoiceText(text) {
  const t = String(text || "");
  return /[\u4e00-\u9fff]/.test(t) || /[A-Za-z0-9]/.test(t);
}

function speakDetached(text) {
  const spoken = clampSpoken(text, MAX_RESULT_CHARS);
  const voice = resolveVoice(HERMES_VOICES, detectLang(spoken));
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

function main() {
  const payload = readStdinJson();
  const event = payload.hook_event_name || process.argv[2] || "";
  log({ event, extraKeys: Object.keys(payload.extra || {}) });

  if (event === "pre_llm_call") {
    const text = latestUserText(payload);
    const cue = playOpening({ content: text }, HERMES_VOICES);
    log({ event, did: "open", cue: cue.key, lang: cue.lang, hasText: Boolean(text) });
    return;
  }

  if (event === "post_llm_call") {
    const reply = latestAssistantText(payload);
    const marker = extractVoiceMarker(reply);
    if (isUsefulVoiceText(marker)) {
      speakDetached(marker);
      log({ event, did: "marker" });
    } else {
      log({ event, did: "no-marker", hasReply: Boolean(reply) });
    }
  }
}

main();
