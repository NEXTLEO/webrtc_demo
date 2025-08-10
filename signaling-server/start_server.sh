#!/bin/bash

# WebRTC 信令服务器启动脚本
cd /root/develop/webrtc_demo-main/signaling-server

# 停止之前的服务器进程
pkill -f "node server.js" 2>/dev/null

# 等待进程完全停止
sleep 2

# 启动服务器并重定向输出
nohup node server.js > server.log 2>&1 &

# 获取进程ID
SERVER_PID=$!
echo "服务器已启动，PID: $SERVER_PID"

# 等待服务器启动
sleep 3

# 检查服务器是否正常运行
if ps -p $SERVER_PID > /dev/null; then
    echo "✅ 服务器启动成功"
    echo "📍 Web访问: http://123.56.125.236:3001"
    echo "🔌 WebSocket: ws://123.56.125.236:3001"
    echo "📊 健康检查: http://123.56.125.236:3001/api/health"
else
    echo "❌ 服务器启动失败"
    exit 1
fi
