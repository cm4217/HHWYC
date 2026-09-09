@echo off
chcp 65001 >nul
title chem-prop-predictor Local OCR Server Setup
echo ==================================================
echo  chem-prop-predictor Local OCR Server Setup
echo ==================================================
echo.
echo This will create a Python virtual environment and
echo install MolScribe / DECIMER / MolNexTR, then start
echo the local OCR server. First run may take 5-15 min.
echo.
pause
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0setup_ocr_server.ps1"
echo.
echo Server stopped. Press any key to close.
pause >nul
