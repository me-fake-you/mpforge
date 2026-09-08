@echo off
setlocal
set "MPFORGE_ROOT=%~dp0..\.."
call "%MPFORGE_ROOT%\third_party\toolchains\node-v24.19.0-win-x64\corepack.cmd" pnpm %*
exit /b %ERRORLEVEL%
