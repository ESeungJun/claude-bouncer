# Claude Code hook → Claude Bouncer (Windows).
#   powershell -NoProfile -ExecutionPolicy Bypass -File send-notify.ps1 <stop|notification|submit|end>
# Posts the hook's JSON payload (stdin) to the app on 127.0.0.1. Prints nothing
# and always exits 0, so it can never disturb a Claude session.
param([string]$Kind = 'stop')
$ErrorActionPreference = 'SilentlyContinue'
if ($Kind -notin @('stop', 'notification', 'submit', 'end')) { $Kind = 'stop' }
try {
  $body = [Console]::In.ReadToEnd()
  if (-not $body) { $body = '{}' }
  $tokenFile = Join-Path $HOME '.claude\claude-bouncer.token'
  $token = ''
  if (Test-Path $tokenFile) { $token = ((Get-Content $tokenFile -Raw) -replace '[^A-Za-z0-9]', '') }
  $port = if ($env:CLAUDE_BOUNCER_PORT) { $env:CLAUDE_BOUNCER_PORT } else { '17891' }
  function Clean($v) { if (-not $v) { return '' }; $s = ($v -replace '[^\x20-\x7E]', ''); if ($s.Length -gt 200) { $s.Substring(0, 200) } else { $s } }
  $headers = @{
    'X-Claude-Bouncer-Token' = $token
    'X-CB-Kind' = $Kind
    'X-CB-Term-Program' = (Clean $env:TERM_PROGRAM)
    'X-CB-Terminal-Emulator' = (Clean $env:TERMINAL_EMULATOR)
    'X-CB-WT-Session' = (Clean $env:WT_SESSION)
  }
  Invoke-RestMethod -Uri "http://127.0.0.1:$port/notify" -Method Post -ContentType 'application/json; charset=utf-8' `
    -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 2 | Out-Null
} catch {}
exit 0
