#!/usr/bin/env node
// Wire (or unwire) Codex's `notify` in ~/.codex/config.toml to Codex Voice Reply, for
// Codex builds without hooks.json support. Preserves any existing notify program
// (saved to ~/.voice-reply/notify.json as originalNotify, chained at runtime).
//   node manage-notify.mjs add    <skillRoot>
//   node manage-notify.mjs remove <skillRoot>
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
const skillRoot = process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), "..");
if (mode !== "add" && mode !== "remove") {
  console.error("usage: manage-notify.mjs add|remove <skillRoot>");
  process.exit(1);
}

const HOME = homedir();
const configToml = join(HOME, ".codex", "config.toml");
const notifyScript = join(skillRoot, "scripts", "codex-notify.mjs");
const cfgDir = join(HOME, ".voice-reply");
const cfgFile = join(cfgDir, "notify.json");

function loadCfg() { try { return JSON.parse(readFileSync(cfgFile, "utf8")); } catch { return {}; } }
function saveCfg(o) { mkdirSync(cfgDir, { recursive: true }); writeFileSync(cfgFile, JSON.stringify(o, null, 2) + "\n"); }
const isOurs = (val) => val.includes("codex-notify.mjs");

const toml = existsSync(configToml) ? readFileSync(configToml, "utf8") : "";
const lines = toml.split(/\r?\n/);

// Find a TOP-LEVEL `notify = ...` line (before the first [table]; TOML requires it there).
let idx = -1;
for (let i = 0; i < lines.length; i += 1) {
  const t = lines[i].trim();
  if (t.startsWith("[")) break;
  if (/^notify\s*=/.test(t)) { idx = i; break; }
}

if (mode === "add") {
  // Preserve the user's existing notify (unless it's already ours).
  const cfg = loadCfg();
  if (idx >= 0) {
    const val = lines[idx].replace(/^[^=]*=\s*/, "").trim();
    if (!isOurs(val)) {
      try { cfg.originalNotify = JSON.parse(val); } catch { cfg.originalNotify = []; }
    }
  } else if (!Array.isArray(cfg.originalNotify)) {
    cfg.originalNotify = [];
  }
  if (cfg.enabled === undefined) cfg.enabled = true;
  saveCfg(cfg);

  // Single-quoted TOML literal strings → no backslash escaping (safe on Windows paths).
  const newLine = `notify = ['node', '${notifyScript}']`;
  if (existsSync(configToml)) copyFileSync(configToml, configToml + ".bak");
  if (idx >= 0) lines[idx] = newLine;
  else lines.unshift(newLine);
  mkdirSync(dirname(configToml), { recursive: true });
  writeFileSync(configToml, lines.join("\n"));
  console.log(`+ Codex notify → codex-voice-reply in ${configToml}${existsSync(configToml + ".bak") ? " (backup .bak)" : ""}`);
  if (Array.isArray(cfg.originalNotify) && cfg.originalNotify.length) {
    console.log(`  preserved your original notify: ${cfg.originalNotify[0]}`);
  }
} else {
  if (idx < 0 || !isOurs(lines[idx].replace(/^[^=]*=\s*/, "").trim())) {
    console.log("= Codex notify: codex-voice-reply not wired, nothing to remove");
    process.exit(0);
  }
  const cfg = loadCfg();
  const orig = Array.isArray(cfg.originalNotify) ? cfg.originalNotify : [];
  copyFileSync(configToml, configToml + ".bak");
  if (orig.length) lines[idx] = `notify = ${JSON.stringify(orig)}`;
  else lines.splice(idx, 1);
  writeFileSync(configToml, lines.join("\n"));
  console.log(`- Codex notify ${orig.length ? "restored to your original" : "removed"} (backup .bak)`);
}
