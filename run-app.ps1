param(
    [switch]$CheckOnly,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$frontend = Join-Path $projectRoot "frontend"
$processHelper = Join-Path $projectRoot "scripts\launcher_processes.py"

function Invoke-ProcessHelper {
    param([Parameter(Mandatory = $true)][string[]]$HelperArguments)
    $output = & $python $processHelper --project $projectRoot @HelperArguments
    $helperExit = $LASTEXITCODE
    try { $result = ($output -join "`n") | ConvertFrom-Json }
    catch { throw "Cannot inspect Nexora processes. Install backend dependencies: .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt" }
    if ($helperExit -ne 0) { throw $result.error }
    return $result
}

function Stop-OwnedServer {
    param([Parameter(Mandatory = $true)]$Target, [switch]$Cleanup)
    $action = if ($Cleanup) { "cleanup" } else { "stop" }
    $created = ([double]$Target.created).ToString("R", [System.Globalization.CultureInfo]::InvariantCulture)
    $arguments = @($action, "--pid", [string]$Target.pid, "--created", $created, "--kind", $Target.kind)
    if (-not $Cleanup) { $arguments += @("--port", [string]$Target.port) }
    if ($Target.orphan_worker) { $arguments += "--orphan" }
    Invoke-ProcessHelper -HelperArguments $arguments | Out-Null
}

if (-not (Test-Path -LiteralPath $python)) {
    throw "Python virtual environment not found. Create .venv and install requirements first."
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "Node.js/npm not found. Install Node.js LTS and try again."
}

$inspection = Invoke-ProcessHelper -HelperArguments @("inspect")
foreach ($target in @($inspection.targets)) {
    if ($CheckOnly) {
        Write-Host "Verified Nexora $($target.kind) on port $($target.port), PID $($target.pid). It can be restarted safely." -ForegroundColor Cyan
    }
    else {
        Write-Host "Stopping previous Nexora $($target.kind) on port $($target.port)..." -ForegroundColor Yellow
        Stop-OwnedServer -Target $target
    }
}
if ($CheckOnly) {
    Write-Host "Startup check passed. No process was stopped." -ForegroundColor Green
    return
}

if (-not (Test-Path -LiteralPath (Join-Path $frontend "node_modules"))) {
    Write-Host "Installing frontend dependencies for the first run..." -ForegroundColor Cyan
    & npm.cmd --prefix $frontend install
    if ($LASTEXITCODE -ne 0) { throw "Frontend dependency installation failed." }
}

$apiRecord = $null
try {
    $api = Start-Process `
        -FilePath $python `
        -ArgumentList @("-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000", "--reload", "--reload-dir", "backend", "--reload-dir", "agent") `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -PassThru
    $apiRecord = Invoke-ProcessHelper -HelperArguments @("record", "--pid", [string]$api.Id, "--kind", "backend")
    $backendReady = $false
    for ($attempt = 1; $attempt -le 40; $attempt++) {
        $api.Refresh()
        if ($api.HasExited) { throw "Backend exited before startup completed. Check .env and Python dependencies." }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 1
            if ($health.status -eq "ok" -and $health.service -eq "deep-research-agent") {
                $backendReady = $true
                break
            }
        }
        catch {
            Start-Sleep -Milliseconds 400
        }
    }

    if (-not $backendReady) {
        throw "Backend failed to start. Check .env and Python dependencies."
    }

    Write-Host "Nexora is available at http://127.0.0.1:5173" -ForegroundColor Green
    Write-Host "Press Ctrl+C to stop this session." -ForegroundColor DarkGray
    $frontendArguments = @("--prefix", $frontend, "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort")
    if (-not $NoBrowser) { $frontendArguments += "--open" }
    & npm.cmd @frontendArguments
    if ($LASTEXITCODE -ne 0) { throw "Frontend stopped with an error. Check its output above." }
}
finally {
    if ($apiRecord) {
        try { Stop-OwnedServer -Target $apiRecord -Cleanup }
        catch { Write-Warning "Could not clean up this session's backend: $($_.Exception.Message)" }
    }
}
