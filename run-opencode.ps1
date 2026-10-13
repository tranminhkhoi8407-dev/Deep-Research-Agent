param([string]$Binary = "", [string]$Session = "")
$ErrorActionPreference = "Stop"
$ocTaskRoot = $PSScriptRoot
$ocTaskDir = Join-Path $ocTaskRoot "data/opencode"
$ocTaskEnv = Join-Path $ocTaskDir "runtime.env"
if (-not (Test-Path -LiteralPath $ocTaskEnv)) { throw "Run .\.venv\Scripts\python.exe scripts/configure_opencode.py first." }
foreach ($ocTaskLine in Get-Content -LiteralPath $ocTaskEnv) {
    if ($ocTaskLine -match '^(OPENCODE_[A-Z_]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], "Process")
    }
}
if (-not $Binary) {
    $ocTaskLocal = Join-Path $ocTaskDir "runtime/node_modules/opencode-windows-x64/bin/opencode.exe"
    if (Test-Path -LiteralPath $ocTaskLocal) { $Binary = $ocTaskLocal }
    else { $ocTaskCommand = Get-Command opencode -ErrorAction SilentlyContinue; if ($ocTaskCommand) { $Binary = $ocTaskCommand.Source } }
}
if (-not $Binary) { throw "Install the pinned CLI locally: npm.cmd install --prefix data/opencode/runtime opencode-ai@1.19.0 --no-audit --no-fund" }
if ($Session) {
    & $Binary attach $env:OPENCODE_SERVER_URL --session $Session
    exit $LASTEXITCODE
}
foreach ($ocTaskName in @("config", "cache", "state", "data", "workspace")) { New-Item -ItemType Directory -Path (Join-Path $ocTaskDir $ocTaskName) -Force | Out-Null }
$env:XDG_CONFIG_HOME = Join-Path $ocTaskDir "config"
$env:XDG_CACHE_HOME = Join-Path $ocTaskDir "cache"
$env:XDG_STATE_HOME = Join-Path $ocTaskDir "state"
$env:XDG_DATA_HOME = Join-Path $ocTaskDir "data"
$env:OPENCODE_DB = Join-Path $ocTaskDir "data/opencode.db"
$env:OPENCODE_CONFIG_DIR = Join-Path $ocTaskDir "config"
$env:OPENCODE_CONFIG = Join-Path $ocTaskDir "opencode.json"
$env:OPENCODE_DISABLE_PROJECT_CONFIG = "true"
$env:OPENCODE_DISABLE_AUTOUPDATE = "true"
$env:OPENCODE_DISABLE_MODELS_FETCH = "true"
$env:OPENCODE_PURE = "true"
$env:OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = "true"
# Upstream credentials remain in Nexora, not the worker environment.
foreach ($ocTaskKey in @("GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENCODE_API_KEY", "OPENCODE_UPSTREAM_API_KEY")) { [Environment]::SetEnvironmentVariable($ocTaskKey, $null, "Process") }
$ocTaskUri = [Uri]$env:OPENCODE_SERVER_URL
Push-Location (Join-Path $ocTaskDir "workspace")
try { & $Binary serve --pure --hostname 127.0.0.1 --port $ocTaskUri.Port } finally { Pop-Location }
