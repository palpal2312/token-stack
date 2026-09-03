@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0token-stack.ps1" %*
