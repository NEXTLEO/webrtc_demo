#!/bin/bash

# WebRTC 服务器守护脚本
# 定期检查服务器进程，如果没有运行则自动重启

SERVER_DIR="/root/develop/webrtc_demo-main/signaling-server"
LOG_FILE="$SERVER_DIR/daemon.log"
PID_FILE="$SERVER_DIR/server.pid"

# 日志函数
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

# 检查服务器是否运行
check_server() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            return 0  # 服务器运行中
        else
            rm -f "$PID_FILE"
            return 1  # 服务器未运行
        fi
    else
        return 1  # 没有PID文件
    fi
}

# 启动服务器
start_server() {
    cd "$SERVER_DIR"
    
    # 停止现有进程
    pkill -f "node server.js" 2>/dev/null
    sleep 2
    
    # 启动新进程
    nohup node server.js > server.log 2>&1 &
    SERVER_PID=$!
    
    # 保存PID
    echo $SERVER_PID > "$PID_FILE"
    
    log "服务器已启动，PID: $SERVER_PID"
    
    # 等待启动
    sleep 3
    
    # 验证启动
    if ps -p $SERVER_PID > /dev/null 2>&1; then
        log "✅ 服务器启动成功"
        return 0
    else
        log "❌ 服务器启动失败"
        rm -f "$PID_FILE"
        return 1
    fi
}

# 测试服务器响应
test_server() {
    response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/health 2>/dev/null)
    if [ "$response" = "200" ]; then
        return 0  # 服务器响应正常
    else
        return 1  # 服务器无响应
    fi
}

# 主循环
main() {
    log "启动WebRTC服务器守护进程"
    
    while true; do
        if ! check_server; then
            log "⚠️ 服务器进程未运行，尝试重启..."
            start_server
        elif ! test_server; then
            log "⚠️ 服务器无响应，尝试重启..."
            start_server
        else
            # 服务器正常运行
            sleep 30  # 每30秒检查一次
        fi
        
        sleep 10
    done
}

# 处理信号
trap 'log "收到终止信号，停止守护进程"; exit 0' SIGTERM SIGINT

# 启动守护进程
main
