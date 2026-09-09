# 在仓库根目录启动 HHWYC 静态站（默认 http://127.0.0.1:8080）
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  Write-Host "[错误] 未找到 python。请安装 Python 3 并加入 PATH。" -ForegroundColor Red
  exit 1
}

Write-Host "正在启动 HHWYC（http://127.0.0.1:8080 ）..." -ForegroundColor Cyan
Write-Host "按 Ctrl+C 停止服务"
python serve.py
