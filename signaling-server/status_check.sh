#!/bin/bash

# WebRTC服务器状态监控脚本

SERVER_DIR="/root/develop/webrtc_demo-main/signaling-server"

echo "=== WebRTC 服务器状态监控 ==="
echo

# 检查进程状态
echo "📊 进程状态:"
ps aux | grep "node server.js" | grep -v grep | while read line; do
    echo "✅ $line"
done

echo

# 检查端口
echo "🔌 端口状态:"
netstat -tlnp 2>/dev/null | grep ":3001" && echo "✅ 端口3001正在监听" || echo "❌ 端口3001未监听"

echo

# 检查API响应
echo "🌐 API状态:"
response=$(curl -s -w "\n状态码: %{http_code}\n响应时间: %{time_total}s" http://localhost:3001/api/health)
echo "$response"

echo

# 检查守护进程
echo "🛡️ 守护进程状态:"
ps aux | grep "robust_daemon.sh" | grep -v grep | while read line; do
    echo "✅ $line"
done

echo

# 显示最新日志
echo "📜 最新日志 (最后10行):"
if [ -f "$SERVER_DIR/daemon.log" ]; then
    tail -10 "$SERVER_DIR/daemon.log"
else
    echo "❌ 找不到日志文件"
fi

echo
echo "=== 监控完成 ==="
