#!/bin/bash

# 机器人端集成服务器部署脚本
# 同时运行信令服务器和Web客户端

echo "=== 机器人端集成服务器部署 ==="

# 检查是否在机器人端运行
if [ ! -f "robot_client.py" ]; then
    echo "错误: 此脚本应在robot-webrtc目录中运行"
    exit 1
fi

# 创建集成服务器目录
INTEGRATED_SERVER_DIR="../integrated-server"
mkdir -p "$INTEGRATED_SERVER_DIR"

echo "正在设置集成服务器..."

# 复制信令服务器代码
cp -r ../signaling-server/* "$INTEGRATED_SERVER_DIR/"

# 复制Web客户端代码
cp -r ../web-client "$INTEGRATED_SERVER_DIR/"

cd "$INTEGRATED_SERVER_DIR"

# 安装依赖
echo "安装Node.js依赖..."
npm install

# 构建Web客户端
echo "构建Web客户端..."
npm run build

echo "=== 部署完成 ==="
echo "集成服务器已部署到: $INTEGRATED_SERVER_DIR"
echo ""
echo "启动方式:"
echo "1. 启动集成服务器: cd $INTEGRATED_SERVER_DIR && npm start"
echo "2. 启动机器人客户端: python robot_client.py --server ws://localhost:3001"
echo "3. 浏览器访问: http://localhost:3001"
echo ""
echo "外网访问:"
echo "将localhost替换为机器人的实际IP地址"
