@echo off
echo 安装集成服务器依赖...
cd /d "%~dp0signaling-server"
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo 依赖安装失败
    pause
    exit /b 1
)

echo 构建Web客户端...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo Web客户端构建失败
    pause
    exit /b 1
)

echo 安装完成！
echo 现在可以运行 start-integrated.bat 来启动服务器
pause
