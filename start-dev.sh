#!/bin/bash

# 开发环境启动脚本

echo "=== WebRTC机器人监控系统 - 开发环境启动 ==="

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未安装Node.js"
    exit 1
fi

# 检查Python3
if ! command -v python3 &> /dev/null; then
    echo "错误: 未安装Python3"
    exit 1
fi

# 启动信令服务器
echo "启动信令服务器..."
cd signaling-server
if [ ! -d "node_modules" ]; then
    echo "安装信令服务器依赖..."
    npm install
fi
npm start &
SIGNALING_PID=$!
cd ..

# 等待信令服务器启动
sleep 3

# 启动Web客户端
echo "启动Web客户端..."
cd web-client
if [ ! -d "node_modules" ]; then
    echo "安装Web客户端依赖..."
    npm install
fi
npm run dev &
WEB_PID=$!
cd ..

echo "=== 启动完成 ==="
echo "信令服务器: http://localhost:3001"
echo "Web客户端: http://localhost:8080"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 等待中断信号
trap "echo '正在停止服务...'; kill $SIGNALING_PID $WEB_PID; exit" INT
wait
