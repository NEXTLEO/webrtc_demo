#!/bin/bash

# 集成服务器启动脚本

echo "=== WebRTC机器人监控 - 集成服务器 ==="

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未安装Node.js"
    echo "请安装Node.js: https://nodejs.org/"
    exit 1
fi

# 进入信令服务器目录
cd signaling-server

# 检查是否已安装依赖
if [ ! -d "node_modules" ]; then
    echo "安装依赖..."
    npm install
fi

# 构建Web客户端
echo "构建Web客户端..."
npm run build

echo "=== 启动集成服务器 ==="
echo "服务将同时提供:"
echo "- WebRTC信令服务"
echo "- Web客户端界面"
echo "- API接口"
echo ""

npm start
