param(
    [Parameter(Mandatory = $true)]
    [string]$AudioFile,

    [Parameter(Mandatory = $true)]
    [string]$ReferenceText,

    [string]$SpeechRegion = "eastus",
    [string]$Language = "en-US",
    [ValidateSet("IPA", "SAPI")]
    [string]$PhonemeAlphabet = "IPA",
    [int]$NBestPhonemeCount = 5,
    [string]$OutputLabel = "pronunciation",
    [switch]$EnableProsody,
    [switch]$EnableMiscue
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    python -m venv .venv
}

& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt

if (-not $env:SPEECH_KEY) {
    $SecureKey = Read-Host "Paste SPEECH_KEY" -AsSecureString
    $Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)
    try {
        $env:SPEECH_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
    }
}

$env:SPEECH_REGION = $SpeechRegion

$ArgsList = @(
    "assess_pronunciation.py",
    "--audio-file", $AudioFile,
    "--reference-text", $ReferenceText,
    "--language", $Language,
    "--phoneme-alphabet", $PhonemeAlphabet,
    "--nbest-phoneme-count", $NBestPhonemeCount,
    "--output-label", $OutputLabel
)

if ($EnableProsody) {
    $ArgsList += "--enable-prosody"
}

if ($EnableMiscue) {
    $ArgsList += "--enable-miscue"
}

& ".\.venv\Scripts\python.exe" @ArgsList
