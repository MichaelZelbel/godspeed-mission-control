@echo off
rem mc-notebook-sync is a shell program. Windows cannot run one by itself, so this starts it with the bash that comes with Git.
set "GODSPEED_BASH="
for /f "delims=" %%G in ('where git.exe 2^>nul') do if exist "%%~dpG..\bin\bash.exe" set "GODSPEED_BASH=%%~dpG..\bin\bash.exe"
if not defined GODSPEED_BASH (echo mc-notebook-sync needs Git for Windows, which brings the bash it runs with. Install Git and try again. 1>&2 & exit /b 1)
"%GODSPEED_BASH%" "%~dp0mc-notebook-sync" %*
