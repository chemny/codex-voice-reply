#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { playOpening, playDetached, detectLang, detectContentLang, resolveVoice, clampSpoken, promptText } from "./opening.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const speakScript = join(__dirname, "speak.mjs");
const logPath = join(homedir(), ".voice-reply", "hook.log");
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const LOG_BACKUPS = 3;

function rotateLog(path) {
  try {
    if (!existsSync(path) || statSync(path).size < MAX_LOG_BYTES) return;
    const oldest = `${path}.${LOG_BACKUPS}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let i = LOG_BACKUPS - 1; i >= 1; i -= 1) {
      const older = `${path}.${i}`;
      const newer = `${path}.${i + 1}`;
      if (existsSync(older)) renameSync(older, newer);
    }
    renameSync(path, `${path}.1`);
  } catch {
    // Rotation must never break a hook.
  }
}

// Codex 的音色：中文女声 + 英文女声（config.json 的 voice / voiceEn），按语种自动选用。
function codexVoices() {
  let cfg = {};
  try {
    cfg = JSON.parse(readFileSync(join(homedir(), ".voice-reply", "config.json"), "utf8"));
  } catch {
    cfg = {};
  }
  return {
    zh: cfg.voice || "zh-CN-XiaoxiaoNeural",
    en: cfg.voiceEn || "en-US-AriaNeural",
  };
}

// 调用方（如 Claude Code 的 claude-hook，转交摘要时）会用环境变量指定音色。
// 这种"被借用"的情况，必须用调用方传入的音色，不能用 Codex 自己的女声——否则串声。
const INHERITED_VOICE = process.env.VOICE_REPLY_VOICE || "";
// 选音色：优先调用方指定（继承），否则按语种用 Codex 自己的音色。
function pickVoice(voices, lang) {
  return INHERITED_VOICE || resolveVoice(voices, lang);
}

function resultLanguage(text, config) {
  return config.resultLang === "zh" || config.resultLang === "en"
    ? config.resultLang
    : detectContentLang(text);
}

const defaults = {
  enabled: true,
  start: true,
  stop: true,
  stopMode: "marker",
  nodeEvents: false,
  nodeTools: ["apply_patch"],
  texts: {
    UserPromptSubmit: "好的。",
    Stop: "已完成，请查看结果。",
    StopEn: "Done. Check the result.",
    StopSummaryPrefix: "已完成。",
    PreToolUse: "开始执行工具。",
    PostToolUse: "工具执行完成。",
  },
  maxResultChars: 60,
  maxSummarySentences: 1,
  multiAgentMode: "root-only",
  openingDedupMs: 3000,
  resultLang: "auto",
  suppressMaintenance: true,
};

const SILENT_AGENT_MARKER = /(?:\[|<)voice-silent-subagent(?:\]|>)/i;

// Codex hook payloads currently do not consistently expose a parent/root field.
// Prefer explicit metadata when available, and use the task marker mandated by
// the agent instructions as the stable fallback.
function subAgentReason(input, config) {
  if (config.multiAgentMode !== "root-only") return "";
  const event = String(input.hook_event_name || "");
  if (event === "SubagentStart" || event === "SubagentStop") return `event:${event}`;
  if (input.is_subagent === true || input.is_child_agent === true) return "explicit-flag";
  if (input.parent_agent_id || input.parent_session_id || input.parent_turn_id) return "parent-id";
  const role = String(input.agent_role || input.role || input.agent_kind || "").toLowerCase();
  if (/^(?:subagent|sub-agent|child|worker|reviewer)$/.test(role)) return `role:${role}`;
  const taskPath = String(input.agent_task_path || input.task_path || process.env.CODEX_AGENT_TASK_PATH || "");
  if (taskPath && taskPath !== "/root" && taskPath.startsWith("/root/")) return "task-path";
  if (SILENT_AGENT_MARKER.test(String(input.prompt || ""))) return "prompt-marker";
  // Some Codex builds pass the parent transcript to a worker while assigning
  // that worker its own session_id. A mismatch is strong local sub-agent evidence.
  const sessionId = String(input.session_id || "").toLowerCase();
  const transcriptName = basename(String(input.transcript_path || "")).toLowerCase();
  const transcriptSession = transcriptName.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] || "";
  if (sessionId && transcriptSession && transcriptSession !== sessionId) return "transcript-owner-mismatch";
  return "";
}

// Hook invocations are separate processes, so keep the short opening debounce
// in VOICE_HOME. This suppresses bursty duplicate submissions when several
// agents start together; explicit sub-agent detection remains the primary rule.
function claimOpening(config) {
  const dedupMs = Number(config.openingDedupMs);
  if (!Number.isFinite(dedupMs) || dedupMs <= 0) return true;
  const statePath = join(homedir(), ".voice-reply", "opening-state.json");
  const now = Date.now();
  try {
    if (existsSync(statePath)) {
      const age = now - statSync(statePath).mtimeMs;
      if (age >= 0 && age < dedupMs) return false;
      try { unlinkSync(statePath); } catch { /* another hook may refresh it */ }
    }
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ ts: new Date(now).toISOString(), pid: process.pid }) + "\n", { flag: "wx" });
    return true;
  } catch {
    // If another process wins the create race, treat this invocation as a duplicate.
    return false;
  }
}

// 显式播报标记 <<voice: ...>>：模型为耳朵写的那句。Stop 只播这个标记。
const VOICE_MARKER = /(?:<<\s*voice\s*:\s*([\s\S]*?)>>|<!--\s*voice\s*:\s*([\s\S]*?)-->)/gi;

function extractVoiceMarker(text) {
  if (!text) return "";
  const re = new RegExp(VOICE_MARKER);
  let match;
  let last = "";
  while ((match = re.exec(text)) !== null) last = match[1] ?? match[2] ?? "";
  const cleaned = last.replace(/\s+/g, " ").trim();
  return isUsefulVoiceText(cleaned) ? cleaned : "";
}

function isUsefulVoiceText(text) {
  // 必须含至少一个汉字或字母/数字；纯标点/省略号/破折号/emoji 一律视为无效。
  const t = String(text || "");
  return /[\u4e00-\u9fff]/.test(t) || /[A-Za-z0-9]/.test(t);
}

const INTERNAL_MAINTENANCE_PATTERNS = [
  /^\s*Consolidation complete\.?\s*$/i,
  /^\s*Consolidated the new rollouts into\s*:/i,
  /^\s*Updated MEMORY\.md and memory_summary\.md(?: in incremental mode)?\.?\s*$/i,
  /\bconsolidat(?:e|ed|ing|ion)\b[\s\S]{0,240}\b(?:new rollouts?|MEMORY\.md|memory_summary\.md)\b/i,
];

function isInternalMaintenanceText(text) {
  const normalized = String(text || "").trim();
  return normalized !== "" && INTERNAL_MAINTENANCE_PATTERNS.some((pattern) => pattern.test(normalized));
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

function log(event, data = {}) {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    rotateLog(logPath);
    appendFileSync(logPath, JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...data,
    }) + "\n");
  } catch {
    // Logging must never break a hook.
  }
}

function loadConfig() {
  const configPath = join(homedir(), ".voice-reply", "hooks.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function truncateText(text, maxChars) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (!Number.isFinite(maxChars) || maxChars <= 0) return normalized;
  if ([...normalized].length <= maxChars) return normalized;
  return [...normalized].slice(0, maxChars).join("").replace(/[，。,.!?！？、\s]+$/u, "") + "。";
}

function speak(args, voice) {
  log("speak", { args, voice });
  if (process.env.VOICE_REPLY_DRY_RUN === "1") {
    process.stdout.write(JSON.stringify({ announceArgs: args, voice }, null, 2) + "\n");
    return;
  }
  playDetached(process.execPath, [speakScript, ...args], voice ? { VOICE_REPLY_VOICE: voice } : undefined);
}

function shouldSpeakNode(input, config) {
  if (!config.nodeEvents) return false;
  const toolName = input.tool_name || "";
  return config.nodeTools.includes(toolName);
}

function redactSensitiveText(text) {
  return String(text || "")
    .replace(/(?:sk|pk|rk|ghp|github_pat|xox[baprs])-[-_A-Za-z0-9]{16,}/g, "已隐藏的密钥")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "已隐藏的邮箱")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "已隐藏的数字");
}

function stripMarkdown(text) {
  return redactSensitiveText(text)
    .replace(/(?:<<\s*voice\s*:\s*[\s\S]*?>>|<!--\s*voice\s*:\s*[\s\S]*?-->)/gi, " ")
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .replace(/::[a-zA-Z-]+(?:\{[^}]*\})?/g, " ")
    .replace(/\b[a-z0-9_.-]*(?:codex|voice|announce|hook|hooks|skill|tts|edge|markdown|json|dry-run|payload|stop|userpromptsubmit|lastassistantmessage|last_assistant_message)[a-z0-9_.-]*\b/gi, "语音播报")
    .replace(/\b(?:node|python3?|npm|pip|rg|sed|chmod|find|printf)\b/gi, " ");
}

function shortenPaths(text) {
  return text.replace(/(?:~|\/Users\/[^\s，。；；、)）\]]+|\/[A-Za-z0-9._-][^\s，。；；、)）\]]*)/g, (match) => {
    const parts = match.split("/").filter(Boolean);
    if (parts.length === 0) return match;
    const last = parts[parts.length - 1] || match;
    return last.length > 40 ? "相关文件" : last;
  });
}

function splitSentences(text) {
  const normalized = text
    .replace(/\r/g, "\n")
    .replace(/\n+/g, "。")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  const matches = normalized.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [normalized];
  return matches
    .map((sentence) => sentence.trim().replace(/[。！？!?；;]+$/g, ""))
    .filter(Boolean);
}

function scoreSentence(sentence) {
  let score = 0;
  if (/(已完成|完成了|已经|可以|能够|跑通|生效|可用|通过|解决|修复|配置好|安装好|改好了|升级|结果是|现在可以)/.test(sentence)) score += 4;
  if (/(结果|效果|现在|目前|已经可以|后续|下一步|能区分|不再|更简洁)/.test(sentence)) score += 2;
  if (/(失败|不能|没有|需要|注意|还差|限制|未能)/.test(sentence)) score += 1;
  if (sentence.length >= 8 && sentence.length <= 90) score += 1;
  if (/(修改了|新增了|测试通过|语法检查|校验|dry run|dry-run|文件|脚本|路径|配置文件|函数|实现细节|命令|参考|来源|代码|参数|输出)/i.test(sentence)) score -= 3;
  if (/^(参考|来源|路径|示例|命令|当前验证结果|测试结果|完成内容|注意一点)$/.test(sentence)) score -= 3;
  if (/^[-*#>`]/.test(sentence)) score -= 2;
  return score;
}

function polishForSpeech(text) {
  return text
    .replace(/^(已完成|完成了|已经完成)[，。；:\s]*/g, "")
    .replace(/^(主要完成了|主要是|本次|这次)[，。；:\s]*/g, "")
    .replace(/\b[a-z0-9_.-]*(?:codex|voice|announce|hook|hooks|skill|tts|edge|markdown|json|dry-run|payload|stop|userpromptsubmit|lastassistantmessage|last_assistant_message)[a-z0-9_.-]*\b/gi, "语音播报")
    .replace(/(?:语音播报[的\s]*){2,}/g, "语音播报的")
    .replace(/语音播报的摘要播报/g, "语音摘要播报")
    .replace(/语音播报摘要播报/g, "语音摘要播报")
    .replace(/\s+/g, "")
    .replace(/；+/g, "，")
    .replace(/[，。；、\s]+$/g, "");
}

function buildSummary(message, config) {
  const cleaned = redactSensitiveText(message)
    .replace(/(?:<<\s*voice\s*:\s*[\s\S]*?>>|<!--\s*voice\s*:\s*[\s\S]*?-->)/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/::[a-zA-Z-]+(?:\{[^}]*\})?/g, " ")
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]+/g, "相关文件")
    .replace(/^\s*(?:#{1,6}|[-*+]|\d+\.)\s*/gm, "")
    .replace(/[\r\n]+/g, "。")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = splitSentences(cleaned);
  if (sentences.length === 0) return "";

  const ranked = sentences
    .map((sentence, index) => {
      let score = 0;
      if (/(需要你|请你|请选择|请确认|请回复|告诉我|你来决定|是否继续|能否继续)/.test(sentence)) score += 12;
      if (/(失败|错误|不能|无法|缺少|阻塞|异常|未通过|有风险)/.test(sentence)) score += 9;
      if (/(已完成|完成了|已修复|修复了|已通过|通过了|已安装|已配置|状态正常|可以使用|已经正常)/.test(sentence)) score += 7;
      if (/(下一步|然后|之后|重启|重试|确认后)/.test(sentence)) score += 4;
      if ([...sentence].length >= 6 && [...sentence].length <= 80) score += 2;
      if (/^(参考|路径|命令|文件|测试细节|实现细节)[:：]?/.test(sentence)) score -= 5;
      return { sentence, index, score };
    })
    .filter(({ sentence }) => [...sentence].length >= 3)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked[0]?.sentence || sentences[0] || "";
}

// Codex can emit Stop for internal continuation turns as well as the user's
// final result. Never read tool-shaped payloads or weak intermediate notes.
function intermediateStopReason(message) {
  const text = String(message || "").trim();
  if (!text) return "empty";
  if (/```|<tool(?:_|-)?(?:call|result)|\b(?:tool_call|tool_result|function_call)\b/i.test(text)) return "tool-payload";
  if (/^\s*(?:related files?|files?|references?|sources?|相关文件|参考资料|文件列表)\s*[:：]?\s*$/i.test(text)) return "section-label";
  return "";
}

function resultShape(message) {
  const text = String(message || "").trim();
  if (/^\s*[\[{]/.test(text)) return "structured";
  if (/^\s*(?:[-*+]\s+|\d+\.\s+).+(?:\n\s*(?:[-*+]\s+|\d+\.\s+).+)+/m.test(text)) return "list";
  return "plain";
}

function completionFallback(message, config) {
  return detectLang(String(message || "")) === "en"
    ? (config.texts.StopEn || "Done. Check the result.")
    : (config.texts.Stop || "任务已完成，请查看结果。");
}

function hasTerminalEvidence(text) {
  const value = String(text || "");
  const decision = /(?:需要你|请你|请选择|请确认|请回复|告诉我|是否继续|是否允许|can you confirm|please (?:choose|confirm|reply)|need your)/i;
  const outcome = /(?:已完成|完成了|已经完成|已修复|修复了|已解决|解决了|已通过|通过了|已安装|已配置|已更新|已发布|已同步|检查完成|测试通过|问题是|原因是|无法完成|未能完成|仍然失败|still fails?|completed|finished|fixed|resolved|passed|installed|configured|updated|published|synced|could not complete|unable to complete)/i;
  return decision.test(value) || outcome.test(value);
}

function buildTerminalSummary(message, config) {
  const reason = intermediateStopReason(message);
  if (reason) return { summary: "", reason };
  const shape = resultShape(message);
  if (shape === "structured") {
    return { summary: completionFallback(message, config), reason: "" };
  }
  const summary = buildSummary(message, config);
  if (!summary) return { summary: "", reason: "empty-summary" };
  if (shape === "list") return { summary, reason: "" };
  if (!hasTerminalEvidence(summary)) return { summary: "", reason: "no-terminal-evidence" };
  return { summary, reason: "" };
}

function main() {
  const input = readStdinJson();
  const config = { ...defaults, ...loadConfig() };
  config.texts = { ...defaults.texts, ...(config.texts || {}) };

  if (config.enabled === false) {
    log("disabled");
    return;
  }

  const event = input.hook_event_name || process.argv[2] || "";
  const suppressedAsSubAgent = subAgentReason(input, config);
  log("hook", {
    hook_event_name: event,
    session_id: input.session_id || "",
    turn_id: input.turn_id || "",
    input_keys: Object.keys(input),
    has_last_assistant_message: Boolean(input.last_assistant_message),
    agent_scope: suppressedAsSubAgent ? "sub-agent" : "root-or-unknown",
    transcript_file: input.transcript_path ? basename(String(input.transcript_path)) : "",
  });
  if (suppressedAsSubAgent) {
    log("suppressed", { reason: suppressedAsSubAgent, hook_event_name: event });
    return;
  }
  if (event === "UserPromptSubmit" && config.start) {
    if (config.suppressMaintenance !== false && isInternalMaintenanceText(promptText(input))) {
      log("open", { source: "internal-maintenance-silent" });
      return;
    }
    if (!claimOpening(config)) {
      log("suppressed", { reason: "opening-dedup", hook_event_name: event });
      return;
    }
    // 走和 Claude 一样的通用开场规则（opening.mjs）：按语种 + 类型分类，后台、缓存。
    const cue = playOpening(input, codexVoices());
    log("open", { cue: cue.key, lang: cue.lang });
    return;
  }

  if (event === "Stop" && config.stop) {
    const voices = codexVoices();
    const marker = extractVoiceMarker(input.last_assistant_message);
    if (marker) {
      // 模型主动写的播报标记：直接念，最准。音色按标记语种选（与 Claude 一致）。
      log("stop", { source: "marker" });
      // 硬截到 ≤60，但在句末/逗号边界收尾（保证 ≤60 且不切半句）。
      speak(["text", "--text", clampSpoken(marker, config.maxResultChars), "--full"], pickVoice(voices, resultLanguage(marker, config)));
    } else if (config.suppressMaintenance !== false && isInternalMaintenanceText(input.last_assistant_message)) {
      log("stop", { source: "internal-maintenance-silent" });
    } else if (config.stopMode === "summary" || config.stopMode === "auto") {
      const { summary, reason } = buildTerminalSummary(input.last_assistant_message, config);
      if (summary) {
        log("stop", { source: "local-summary" });
        speak(["text", "--text", clampSpoken(summary, config.maxResultChars), "--full"], pickVoice(voices, resultLanguage(summary, config)));
      } else {
        log("stop", { source: "intermediate-silent", reason });
      }
    } else {
      log("stop", { source: "no-marker-silent" });
    }
    return;
  }

  if ((event === "PreToolUse" || event === "PostToolUse") && shouldSpeakNode(input, config)) {
    speak(["text", "--text", config.texts[event], "--full"]);
  }
}

main();
