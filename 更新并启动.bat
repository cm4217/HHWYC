@echo off
chcp 65001 >nul
cd /d "%~dp0"

where git >nul 2>&1
if not errorlevel 1 (
  echo 正在拉取最新代码...
  git pull --ff-only
  echo.
) else (
  echo [提示] 未检测到 git，跳过更新，直接启动。
  echo.
)

where python >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 python。请安装 Python 3，并勾选 “Add python.exe to PATH”。
  pause
  exit /b 1
)

echo 正在启动 HHWYC（http://127.0.0.1:8080 ）...
python serve.py
if errorlevel 1 pause
