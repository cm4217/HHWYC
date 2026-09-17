# 在仓库根目录启动 HHWYC 静态站（默认 http://127.0.0.1:8080，可用 $env:PORT 覆盖）
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

# 与 setup_ocr_server.ps1 一致：优先 python，回退 py -3（Windows Python Launcher）
$python = $null
$pythonArgs = @()
if (Get-Command python -ErrorAction SilentlyContinue) {
  $python = "python"
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  $python = "py"
  $pythonArgs = @("-3")
} else {
  Write-Host "[错误] 未找到 python / py。请安装 Python 3 并加入 PATH。" -ForegroundColor Red
  exit 1
}

$port = if ($env:PORT -and $env:PORT.Trim()) { $env:PORT.Trim() } else { "8080" }
Write-Host "正在启动 HHWYC（http://127.0.0.1:$port ）..." -ForegroundColor Cyan
Write-Host "实际 PORT=$port（若被占用，可执行 `$env:PORT=8090; .\start.ps1）"
Write-Host "使用解释器：$python $($pythonArgs -join ' ')"
Write-Host "按 Ctrl+C 停止服务"
& $python @pythonArgs serve.py
