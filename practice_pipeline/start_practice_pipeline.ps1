param(
    [ValidateSet("read", "repeat", "words", "speaking")]
    [string]$Page = "read"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PipelineRoot = Join-Path $ProjectRoot "practice_pipeline"
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$Server = Join-Path $PipelineRoot "server.py"
$PidPath = Join-Path $PipelineRoot ".server.pid"
$OutLog = Join-Path $PipelineRoot "server.out.log"
$ErrLog = Join-Path $PipelineRoot "server.err.log"
$BaseUrl = "http://127.0.0.1:8765"

function Test-ServerReady {
    try {
        $response = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 2
        return [bool]$response.ok
    }
    catch {
        return $false
    }
}

if (-not (Test-Path -LiteralPath $Python)) {
    python -m venv (Join-Path $ProjectRoot ".venv")
}

& $Python -c "import flask, azure.cognitiveservices.speech" 2>$null
if ($LASTEXITCODE -ne 0) {
    & $Python -m pip install -q -r (Join-Path $ProjectRoot "requirements.txt")
}

if (-not (Test-ServerReady)) {
    if (Test-Path -LiteralPath $PidPath) {
        $oldPidText = Get-Content -LiteralPath $PidPath -Raw
        $oldPid = 0
        if ([int]::TryParse($oldPidText.Trim(), [ref]$oldPid)) {
            $oldProc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
            if ($oldProc) {
                Stop-Process -Id $oldPid -Force
            }
        }
        Remove-Item -LiteralPath $PidPath -Force
    }

    $process = Start-Process `
        -FilePath $Python `
        -ArgumentList @($Server) `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $OutLog `
        -RedirectStandardError $ErrLog `
        -PassThru

    $process.Id | Set-Content -LiteralPath $PidPath -Encoding ASCII

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 400
        if (Test-ServerReady) {
            $ready = $true
            break
        }
    }

    if (-not $ready) {
        throw "Practice server did not become ready. Check $ErrLog"
    }
}

$path = switch ($Page) {
    "repeat" { "/repeat" }
    "words" { "/words" }
    "speaking" { "/speaking" }
    default { "/read" }
}
Start-Process "$BaseUrl$path"
