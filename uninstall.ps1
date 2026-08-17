param(
  [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'
$SkillDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VoiceHome = Join-Path $HOME '.voice-reply'

Write-Host 'Removing Codex Voice Reply hooks...'
node (Join-Path $SkillDir 'scripts\manage-hooks.mjs') remove $SkillDir
try {
  node (Join-Path $SkillDir 'scripts\manage-notify.mjs') remove $SkillDir
} catch {
  Write-Warning 'Notify fallback cleanup could not be completed; inspect ~/.codex/config.toml.'
}

if ($RemoveData -and (Test-Path -LiteralPath $VoiceHome)) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $archived = Join-Path $HOME ".voice-reply-removed-$stamp"
  Move-Item -LiteralPath $VoiceHome -Destination $archived
  Write-Host "Config, cache, and logs were moved to $archived and can be restored."
} else {
  Write-Host 'Config, cache, and logs in ~/.voice-reply were kept.'
  Write-Host 'Run again with -RemoveData to archive them outside the active data directory.'
}

Write-Host 'Restart the agent session to stop voice hooks loaded by the current session.'
