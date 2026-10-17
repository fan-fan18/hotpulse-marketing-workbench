@echo off
chcp 65001 >nul
title HotPulse 热点营销工作台 - 本地服务
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js。
  echo        请先安装 Node 18 或更高版本：https://nodejs.org
  echo        安装完成后重新双击本文件即可。
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
set PORT=%1
if "%PORT%"=="" set PORT=8787

echo ================================================
echo  HotPulse 热点营销工作台 - 本地服务端
echo  Node 版本：%NODEVER%
echo  端口：%PORT%
echo  工作台：http://localhost:%PORT%/index.html
echo  后  台：http://localhost:%PORT%/admin.html
echo  停止服务：关闭本窗口，或按 Ctrl+C
echo ================================================
echo.

start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%/index.html"
node "server\server.js" %PORT%

echo.
echo 服务已停止。按任意键关闭窗口。
pause >nul
