@echo off
cd /d F:\Dropbox\Apps\CollectCore\backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8001