@echo off
echo === WebRTC机器人监控 - 集成服务器 ===

REM 检查Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo 错误: 未安装Node.js
    echo 请安装Node.js: https://nodejs.org/
    pause
    exit /b 1
)

REM 进入信令服务器目录
cd signaling-server

REM 检查是否已安装依赖
if not exist "node_modules" (
    echo 安装依赖...
    npm install
)

REM 构建Web客户端
echo 构建Web客户端...
npm run build

echo === 启动集成服务器 ===
echo 服务将同时提供:
echo - WebRTC信令服务
echo - Web客户端界面  
echo - API接口
echo.

npm start

pause
