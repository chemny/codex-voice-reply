#!/usr/bin/env node
// Voice Reply doctor — verify the whole chain so "no sound" is debuggable.
// Run:  node scripts/doctor.mjs
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const HOME = process.env.VOICE_REPLY_TEST_HOME || homedir();
const VOICE_HOME = join(HOME, ".voice-reply");

let fails = 0;
let warns = 0;
const PASS = (m) => console.log(`  ✓ ${m}`);
const WARN = (m, fix) => { warns++; console.log(`  ⚠ ${m}${fix ? `  → ${fix}` : ""}`); };
const FAIL = (m, fix) => { fails++; console.log(`  ✗ ${m}${fix ? `  → ${fix}` : ""}`); };

function cmdExists(c) {
  if (c.includes("/") || c.includes("\\")) return existsSync(c);
  if (process.platform === "win32") {
    const r = spawnSync("where.exe", [c], { encoding: "utf8" });
    return r.status === 0 && r.stdout.trim().length > 0;
  }
  const r = spawnSync("/bin/sh", ["-lc", `command -v ${c}`], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

console.log("Voice Reply doctor\n");

console.log("Runtime");
Number(process.versions.node.split(".")[0]) >= 18
  ? PASS(`node ${process.version}`)
  : FAIL(`node ${process.version} (need 18+)`, "install Node 18+");
cmdExists("python3") ? PASS("python3") : FAIL("python3 not found", "install Python 3, then rerun the installer");

const venvPy = process.platform === "win32"
  ? join(ROOT, ".venv", "Scripts", "python.exe")
  : join(ROOT, ".venv", "bin", "python");
if (cmdExists("edge-tts")) {
  PASS("edge-tts on PATH");
} else if (existsSync(venvPy)) {
  const r = spawnSync(venvPy, ["-c", "import edge_tts"], { encoding: "utf8" });
  r.status === 0 ? PASS("edge-tts in .venv") : FAIL("edge_tts not importable in .venv", "rerun the installer");
} else {
  FAIL("no edge-tts and no .venv", "rerun the installer");
}

console.log("\nAudio");
const players = ["afplay", "ffplay", "mpv", "mpg123", "cvlc", "paplay", "aplay"];
const player = players.find(cmdExists);
player ? PASS(`player: ${player}`) : FAIL("no audio player found", "install ffplay (ffmpeg), mpv, or mpg123");

console.log("\nConfig & cache");
existsSync(join(VOICE_HOME, "config.json")) ? PASS("config.json") : WARN("config.json missing", "rerun the installer");
existsSync(join(VOICE_HOME, "hooks.json")) ? PASS("hooks.json") : WARN("hooks.json missing", "rerun the installer");
const cacheDir = join(VOICE_HOME, "cache");
const clips = existsSync(cacheDir) ? readdirSync(cacheDir).filter((f) => f.endsWith(".mp3")) : [];
const openingClips = clips.filter((f) => f.startsWith("opening-"));
const speechClips = clips.filter((f) => f.startsWith("speech-"));
openingClips.length ? PASS(`${openingClips.length} opening cache clips`) : WARN("no opening cache", "rerun the installer (else openings live-synth, slower)");
PASS(`${speechClips.length} result speech cache clips`);
existsSync(join(VOICE_HOME, "speech.lock"))
  ? WARN("speech queue is currently busy", "wait for playback to finish; stale locks self-heal after 2 minutes")
  : PASS("speech queue ready");

console.log("\nHook registration");
function checkHooks(label, file, scriptName) {
  if (!existsSync(file)) { WARN(`${label}: ${file} not found`, "rerun the installer and choose to register"); return false; }
  let raw = "";
  try { raw = readFileSync(file, "utf8"); } catch { WARN(`${label}: unreadable`); return false; }
  // Match by script basename — robust to symlinks / realpath differences (/tmp vs /private/tmp,
  // or a skill dir symlinked to a repo). The path being absolute makes exact compares fragile.
  if (!raw.includes(scriptName)) { WARN(`${label}: voice-reply not registered`, "rerun the installer to register"); return false; }
  if (raw.includes(`\\"${scriptName}`) || raw.includes('node \\"')) {
    FAIL(`${label}: hook command path is quoted (some runners take it literally → silent)`, "rerun the installer to rewrite it unquoted");
  } else {
    PASS(`${label}: registered`);
  }
  return true;
}
checkHooks("Claude Code", join(HOME, ".claude", "settings.json"), "claude-hook.mjs");
const codexHooksFile = join(HOME, ".codex", "hooks.json");
const codexRegistered = checkHooks("Codex", codexHooksFile, "codex-hook.mjs");

// Optional Codex notify fallback (for builds without hooks) — only reported if wired.
const codexToml = join(HOME, ".codex", "config.toml");
if (codexRegistered) {
  console.log("\nCodex hook approval");
  let raw = "";
  try { raw = readFileSync(codexToml, "utf8"); } catch { /* reported per hook below */ }
  const normalizedSource = codexHooksFile.replace(/\//g, "\\").toLowerCase();
  for (const [label, eventKey] of [["UserPromptSubmit", "user_prompt_submit"], ["Stop", "stop"]]) {
    const sections = [...raw.matchAll(/^\[hooks\.state\.(?:'([^']+)'|"([^"]+)")\]\s*$/gm)];
    const section = sections.find((match) => {
      const key = (match[1] || match[2] || "").replace(/\//g, "\\").toLowerCase();
      return key.includes(normalizedSource) && key.endsWith(`:${eventKey}:0:0`);
    });
    if (!section) {
      WARN(`${label}: approval required`, "open Codex, run /hooks, and approve this hook");
      continue;
    }
    const start = section.index + section[0].length;
    const next = raw.slice(start).search(/^\[/m);
    const body = raw.slice(start, next < 0 ? raw.length : start + next);
    if (/^enabled\s*=\s*false\s*$/mi.test(body)) {
      WARN(`${label}: disabled`, "open Codex, run /hooks, and enable this hook");
    } else if (/^trusted_hash\s*=\s*["'][^"']+["']\s*$/mi.test(body)) {
      PASS(`${label}: approval record found`);
    } else {
      WARN(`${label}: approval required`, "open Codex, run /hooks, and approve this hook");
    }
  }
}

if (existsSync(codexToml)) {
  try {
    if (/^notify\s*=.*codex-notify\.mjs/m.test(readFileSync(codexToml, "utf8"))) {
      PASS("Codex notify fallback: wired (completion-only)");
    }
  } catch { /* ignore */ }
}

console.log(`\n${fails ? `✗ ${fails} problem(s)` : warns ? `⚠ ${warns} warning(s)` : "✓ all good"} — restart your agent session after any change.`);
process.exit(fails ? 1 : 0);
