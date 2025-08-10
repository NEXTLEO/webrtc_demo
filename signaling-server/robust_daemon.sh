#!/bin/bash

# 强化版WebRTC服务器守护脚本
# 具有更强的稳定性和错误恢复能力

SERVER_DIR="/root/develop/webrtc_demo-main/signaling-server"
LOG_FILE="$SERVER_DIR/daemon.log"
PID_FILE="$SERVER_DIR/server.pid"
ERROR_COUNT_FILE="$SERVER_DIR/error_count"
MAX_ERRORS=5
CHECK_INTERVAL=10

# 初始化错误计数
echo "0" > "$ERROR_COUNT_FILE"

# 日志函数
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# 获取错误计数
get_error_count() {
    if [ -f "$ERROR_COUNT_FILE" ]; then
        cat "$ERROR_COUNT_FILE"
    else
        echo "0"
    fi
}

# 增加错误计数
increment_error_count() {
    local count=$(get_error_count)
    echo $((count + 1)) > "$ERROR_COUNT_FILE"
}

# 重置错误计数
reset_error_count() {
    echo "0" > "$ERROR_COUNT_FILE"
}

# 检查服务器进程
check_server_process() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0  # 进程运行中
        else
            rm -f "$PID_FILE"
            return 1  # 进程不存在
        fi
    else
        return 1  # 没有PID文件
    fi
}

# 测试服务器响应
test_server_response() {
    local response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 http://localhost:3001/api/health 2>/dev/null)
    if [ "$response" = "200" ]; then
        return 0  # 服务器响应正常
    else
        return 1  # 服务器无响应
    fi
}

# 强制清理所有node进程
force_cleanup() {
    log "强制清理所有node server.js进程..."
    pkill -9 -f "node server.js" 2>/dev/null
    sleep 3
    
    # 清理可能占用端口的进程
    local port_process=$(netstat -tlnp 2>/dev/null | grep ":3001 " | awk '{print $7}' | cut -d'/' -f1)
    if [ ! -z "$port_process" ]; then
        log "清理占用端口3001的进程: $port_process"
        kill -9 "$port_process" 2>/dev/null
        sleep 2
    fi
    
    rm -f "$PID_FILE"
}

# 启动服务器
start_server() {
    cd "$SERVER_DIR"
    
    # 强制清理
    force_cleanup
    
    log "启动WebRTC信令服务器..."
    
    # 使用nohup启动，并将stderr重定向到stdout
    nohup node server.js 2>&1 > server.log &
    local server_pid=$!
    
    # 保存PID
    echo $server_pid > "$PID_FILE"
    log "服务器已启动，PID: $server_pid"
    
    # 等待启动
    sleep 5
    
    # 验证启动
    if check_server_process && test_server_response; then
        log "✅ 服务器启动成功并响应正常"
        reset_error_count
        return 0
    else
        log "❌ 服务器启动失败或无响应"
        increment_error_count
        return 1
    fi
}

# 重启服务器
restart_server() {
    local error_count=$(get_error_count)
    log "⚠️ 服务器需要重启 (错误计数: $error_count/$MAX_ERRORS)"
    
    if [ $error_count -ge $MAX_ERRORS ]; then
        log "🚨 错误次数过多，等待60秒后重试..."
        sleep 60
        reset_error_count
    fi
    
    start_server
}

# 主监控循环
main_loop() {
    log "🚀 启动WebRTC服务器守护进程"
    
    # 初始启动
    start_server
    
    while true; do
        sleep $CHECK_INTERVAL
        
        local process_ok=false
        local response_ok=false
        
        # 检查进程
        if check_server_process; then
            process_ok=true
        fi
        
        # 检查响应
        if test_server_response; then
            response_ok=true
        fi
        
        if $process_ok && $response_ok; then
            # 服务器正常，重置错误计数
            reset_error_count
        else
            # 服务器有问题
            if ! $process_ok; then
                log "⚠️ 服务器进程已停止"
            fi
            if ! $response_ok; then
                log "⚠️ 服务器无响应"
            fi
            
            restart_server
        fi
    done
}

# 信号处理
cleanup_and_exit() {
    log "📢 收到终止信号，停止守护进程"
    
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            log "停止服务器进程: $pid"
            kill "$pid" 2>/dev/null
            sleep 3
            
            # 如果进程仍然存在，强制杀死
            if ps -p "$pid" > /dev/null 2>&1; then
                kill -9 "$pid" 2>/dev/null
            fi
        fi
        rm -f "$PID_FILE"
    fi
    
    log "守护进程已停止"
    exit 0
}

# 设置信号陷阱
trap cleanup_and_exit SIGTERM SIGINT SIGHUP

# 启动主循环
main_loop
