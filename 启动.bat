@echo off
chcp 65001 >nul
title Personal ERP 一键启动
cd /d "%~dp0"

echo ============================================
echo   Personal ERP 一键启动
echo ============================================
echo.

REM 首次运行或 dist 缺失时先构建网页端
if not exist "dist\index.html" (
    echo [1/3] 首次运行，正在构建网页端（npm run build）...
    call npm run build
    if errorlevel 1 (
        echo 构建失败，请确认已安装 Node.js 和依赖（npm install）
        pause
        exit /b 1
    )
) else (
    echo [1/3] 网页端已构建（dist 存在）
)

echo [2/3] 启动局域网同步服务（端口 6920）...
start "ERP-Sync" cmd /k "cd /d %~dp0 && python sync_server.py --port 6920"

echo [3/3] 启动网页端（端口 8080）...
start "ERP-Web" cmd /k "cd /d %~dp0 && python -m http.server 8080 --bind 0.0.0.0 --directory dist"

echo.
echo 本机访问:   http://localhost:8080
echo 局域网访问: http://本机IP:8080   （手机浏览器打开）
echo 同步服务:   http://本机IP:6920   （App 内「局域网同步」填此地址）
echo.
echo 本机局域网 IP：
ipconfig | findstr /i "IPv4"
echo.
echo 提示：关闭本窗口不影响服务运行；停止服务请关闭对应的 ERP-Sync / ERP-Web 窗口。
pause