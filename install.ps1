[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $HOME ".agents\skills\codex-voice-reply"),
  [ValidateSet("zh", "en", "auto")]
  [string]$Language = "zh",
  [bool]$RegisterHooks = $true,
  [bool]$AddAgentRules = $false,
  [bool]$EnableNotifyFallback = $false
)

$ErrorActionPreference = "Stop"
$repoUrl = if ($env:VOICE_REPLY_REPO_URL) { $env:VOICE_REPLY_REPO_URL } else { "https://github.com/chemny/codex-voice-reply.git" }
$git = Get-Command git -ErrorAction Stop
$bashCandidates = @(
  (Join-Path (Split-Path (Split-Path $git.Source)) "bin\bash.exe"),
  "C:\Program Files\Git\bin\bash.exe"
)
$bash = $bashCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $bash) { throw "Git for Windows bash.exe was not found." }

if (Test-Path (Join-Path $InstallDir ".git")) {
  & $git.Source -C $InstallDir pull --ff-only
} elseif (Test-Path $InstallDir) {
  throw "$InstallDir already exists but is not a Git checkout."
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null
  & $git.Source clone $repoUrl $InstallDir
}
if ($LASTEXITCODE -ne 0) { throw "Git checkout failed with exit code $LASTEXITCODE." }

function ConvertTo-GitBashPath([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path).Replace("\", "/")
  if ($full -match "^([A-Za-z]):(.*)$") {
    return "/$($Matches[1].ToLower())$($Matches[2])"
  }
  return $full
}

$env:VOICE_REPLY_LANG = $Language
$env:VOICE_REPLY_AUTO_HOOKS = if ($RegisterHooks) { "y" } else { "n" }
$env:VOICE_REPLY_AGENT_RULES = if ($AddAgentRules) { "y" } else { "n" }
$env:VOICE_REPLY_NOTIFY = if ($EnableNotifyFallback) { "y" } else { "n" }
$setup = ConvertTo-GitBashPath (Join-Path $InstallDir "setup.sh")

& $bash -lc "bash '$setup'"
if ($LASTEXITCODE -ne 0) { throw "Codex Voice Reply setup failed with exit code $LASTEXITCODE." }

if ($RegisterHooks) {
  Write-Host ""
  Write-Host "Codex Voice Reply is installed, but Codex hook approval is still needed." -ForegroundColor Yellow
  Write-Host "In Codex, run /hooks and approve UserPromptSubmit and Stop." -ForegroundColor Cyan
  Write-Host "Then start a new task to test the voice." -ForegroundColor Cyan
} else {
  Write-Host "Codex Voice Reply setup completed without hook registration."
}
