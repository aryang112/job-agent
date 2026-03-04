@echo off
REM Setup Windows Task Scheduler to run job agent on boot
REM Run this script as Administrator

set AGENT_DIR=%~dp0
set PYTHON_PATH=python

echo Creating scheduled task: JobAgent
schtasks /create /tn "JobAgent" /tr "%PYTHON_PATH% %AGENT_DIR%agent.py" /sc onlogon /rl highest /f

echo.
echo Task created. The agent will start when you log in.
echo To run manually: python %AGENT_DIR%agent.py
echo To remove: schtasks /delete /tn "JobAgent" /f
pause
