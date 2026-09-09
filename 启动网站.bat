@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 python。请安装 Python 3，并勾选 “Add python.exe to PATH”。
  echo 下载：https://www.python.org/downloads/
  pause
  exit /b 1
)

echo 正在启动 HHWYC（http://127.0.0.1:8080 ）...
echo 关闭本窗口或按 Ctrl+C 可停止服务。
echo.
python serve.py
if errorlevel 1 (
  echo.
  echo 启动失败。若提示端口占用，可先关闭其他程序，或执行：
  echo   set PORT=8090 ^&^& python serve.py
  pause
)
