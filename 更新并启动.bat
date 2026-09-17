@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

where git >nul 2>&1
if not errorlevel 1 (
  echo 正在拉取最新代码...
  git pull --ff-only
  if errorlevel 1 (
    echo.
    echo [错误] git pull 失败，未更新代码。
    echo 请检查网络、分支状态或本地未提交改动后再试。
    set /p CONTINUE=是否仍用当前本地代码继续启动？(Y/N): 
    if /i not "!CONTINUE!"=="Y" (
      echo 已取消启动。
      pause
      exit /b 1
    )
    echo 将使用当前本地代码继续启动...
    echo.
  ) else (
    echo.
  )
) else (
  echo [提示] 未检测到 git，跳过更新，直接启动。
  echo.
)

set "PYEXE="
where python >nul 2>&1 && set "PYEXE=python"
if not defined PYEXE (
  where py >nul 2>&1 && set "PYEXE=py -3"
)
if not defined PYEXE (
  echo [错误] 未找到 python / py。请安装 Python 3，并勾选 “Add python.exe to PATH”。
  pause
  exit /b 1
)

echo 正在启动 HHWYC（http://127.0.0.1:8080 ）...
echo 使用解释器：%PYEXE%
%PYEXE% serve.py
if errorlevel 1 pause
