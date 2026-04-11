@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0Kill-CollectCore.ps1"
echo CollectCore stopped.
exit
