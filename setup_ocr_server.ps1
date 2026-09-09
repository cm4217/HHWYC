#Requires -Version 5.1
# One-click installer & launcher for chem-prop-predictor local OCR server
# This script will: check Python -> create venv -> install deps -> start server
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPath = Join-Path $root "venv_ocr"
$serverScript = Join-Path $root "local_ocr_server.py"

function Write-Step($msg) { Write-Host "[Step] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "[ERR]  $msg" -ForegroundColor Red }

Write-Host "=============================================="
Write-Host " chem-prop-predictor Local OCR Server Setup"
Write-Host "==============================================" -ForegroundColor Blue

# 1. Check Python
$python = $null
foreach ($cmd in @("python", "py")) {
    try { $ver = & $cmd --version 2>&1; if ($ver) { $python = $cmd; break } } catch {}
}
if (-not $python) {
    Write-Err "Python not found. Please install Python 3.9+ from https://python.org and add it to PATH."
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Ok "Found Python: $python"

# 2. Create venv
if (-not (Test-Path $venvPath)) {
    Write-Step "Creating virtual environment: $venvPath"
    & $python -m venv $venvPath
    Write-Ok "Virtual environment created."
} else {
    Write-Warn "Virtual environment already exists: $venvPath"
}

# 3. Install / upgrade deps
$pip = Join-Path $venvPath "Scripts\pip.exe"
$deps = "molscribe", "decimer", "molnextr", "pillow", "rdkit"
Write-Step "Installing dependencies (first time may take 5-15 min):"
Write-Host "       $deps"
& $pip install --upgrade pip | Out-Null
& $pip install $deps
if ($LASTEXITCODE -ne 0) {
    Write-Err "Failed to install dependencies. Check your network or Python environment."
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Ok "Dependencies installed."

# 4. Start server
if (-not (Test-Path $serverScript)) {
    Write-Err "Server script not found: $serverScript"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Step "Starting local OCR server..."
Write-Warn "First start will download model weights (1-5 min). Keep this window open."
Write-Host ""
& $python $serverScript
