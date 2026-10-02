$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$frontend = Join-Path $projectRoot "frontend"

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int]$TargetProcessId)

    $children = @(
        Get-CimInstance Win32_Process `
            -Filter "ParentProcessId = $TargetProcessId" `
            -ErrorAction SilentlyContinue
    )

    foreach ($child in $children) {
        Stop-ProcessTree -TargetProcessId $child.ProcessId
    }

    Stop-Process -Id $TargetProcessId -Force -ErrorAction SilentlyContinue
}

function Stop-ExistingProjectListener {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$CommandMarker,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $listener = Get-NetTCPConnection `
        -LocalPort $Port `
        -State Listen `
        -ErrorAction SilentlyContinue | Select-Object -First 1

    if (-not $listener) {
        return
    }

    $process = Get-CimInstance Win32_Process `
        -Filter "ProcessId = $($listener.OwningProcess)" `
        -ErrorAction SilentlyContinue

    if (-not $process -or $process.CommandLine -notlike "*$CommandMarker*") {
        throw "Port $Port is already used by another program. Stop it before running Nexora."
    }

    $targetProcessId = $process.ProcessId
    $parent = Get-CimInstance Win32_Process `
        -Filter "ProcessId = $($process.ParentProcessId)" `
        -ErrorAction SilentlyContinue

    if ($parent -and $parent.ExecutablePath -eq $python) {
        $targetProcessId = $parent.ProcessId
    }

    Write-Host "Stopping stale $Label process on port $Port..." -ForegroundColor Yellow
    Stop-ProcessTree -TargetProcessId $targetProcessId

    for ($attempt = 1; $attempt -le 20; $attempt++) {
        $stillListening = Get-NetTCPConnection `
            -LocalPort $Port `
            -State Listen `
            -ErrorAction SilentlyContinue
        if (-not $stillListening) {
            return
        }
        Start-Sleep -Milliseconds 200
    }

    throw "Could not release port $Port from the previous $Label process."
}

if (-not (Test-Path -LiteralPath $python)) {
    throw "Python virtual environment not found. Create .venv and install requirements first."
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "Node.js/npm not found. Install Node.js LTS and try again."
}

Stop-ExistingProjectListener -Port 8000 -CommandMarker "uvicorn backend.main:app" -Label "backend"
Stop-ExistingProjectListener -Port 5173 -CommandMarker $frontend -Label "frontend"

if (-not (Test-Path -LiteralPath (Join-Path $frontend "node_modules"))) {
    Write-Host "Installing frontend dependencies for the first run..." -ForegroundColor Cyan
    & npm.cmd --prefix $frontend install
}

$api = Start-Process `
    -FilePath $python `
    -ArgumentList @("-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000") `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -PassThru

try {
    $backendReady = $false
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 1
            if ($health.status -eq "ok") {
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
    Write-Host "Press Ctrl+C to stop both frontend and backend." -ForegroundColor DarkGray
    & npm.cmd --prefix $frontend run dev -- --open
}
finally {
    Stop-ProcessTree -TargetProcessId $api.Id
}
