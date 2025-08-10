/**
 * WebRTC Web客户端
 * 用于连接机器人视频流
 */

class RobotWebRTCClient {
    constructor() {
        this.websocket = null;
        this.peerConnection = null;
        this.localClientId = null;
        this.remoteClientId = null;
        this.isConnected = false;
        this.currentRoom = null;
        this.statsInterval = null;
        this.mediaRecorder = null;
        this.isRecording = false;
        
        // 重连机制
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;
        this.reconnectTimer = null;
        this.shouldReconnect = true;
        this.isReconnecting = false; // 添加重连状态标记
        
        // 心跳机制
        this.pingInterval = null;
        this.pingIntervalMs = 25000; // 25秒发送一次心跳
        this.lastPongTime = Date.now();
        
        // 自动检测服务器地址
        this.defaultServerUrl = this.getDefaultServerUrl();
        
        // ICE服务器配置 - 添加更多STUN服务器提高连接成功率
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            // 阿里云STUN服务器
            { urls: 'stun:stun.qq.com:3478' },
            // 腾讯云STUN服务器  
            { urls: 'stun:stun.miwifi.com:3478' },
            // 外网连接时可能需要TURN服务器
            // { 
            //     urls: 'turn:your-turn-server.com:3478',
            //     username: 'username',
            //     credential: 'password'
            // }
        ];
        
        this.initializeUI();
        this.bindEvents();
    }
    
    getDefaultServerUrl() {
        // 自动检测当前页面的协议和主机
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        return `${protocol}//${host}`;
    }
    
    initializeUI() {
        // 获取DOM元素
        this.elements = {
            serverUrl: document.getElementById('server-url'),
            roomSelection: document.getElementById('room-selection'),
            refreshRoomsBtn: document.getElementById('refresh-rooms'),
            connectBtn: document.getElementById('connect-btn'),
            disconnectBtn: document.getElementById('disconnect-btn'),
            
            remoteVideo: document.getElementById('remote-video'),
            videoOverlay: document.getElementById('video-overlay'),
            fullscreenBtn: document.getElementById('fullscreen-btn'),
            screenshotBtn: document.getElementById('screenshot-btn'),
            recordBtn: document.getElementById('record-btn'),
            
            muteBtn: document.getElementById('mute-btn'),
            volumeSlider: document.getElementById('volume-slider'),
            volumeDisplay: document.getElementById('volume-display'),
            
            connectionStatus: document.getElementById('connection-status'),
            webrtcStatus: document.getElementById('webrtc-status'),
            
            // 统计信息元素
            statConnectionState: document.getElementById('stat-connection-state'),
            statIceState: document.getElementById('stat-ice-state'),
            statLatency: document.getElementById('stat-latency'),
            statPacketLoss: document.getElementById('stat-packet-loss'),
            statBandwidth: document.getElementById('stat-bandwidth'),
            statFramerate: document.getElementById('stat-framerate'),
            
            videoResolution: document.getElementById('video-resolution'),
            videoFps: document.getElementById('video-fps'),
            videoBitrate: document.getElementById('video-bitrate'),
            
            logMessages: document.getElementById('log-messages'),
            clearLogBtn: document.getElementById('clear-log'),
            autoScrollCheckbox: document.getElementById('auto-scroll')
        };
        
        this.log('系统初始化完成', 'info');
        
        // 自动设置服务器地址
        if (this.elements.serverUrl && !this.elements.serverUrl.value) {
            this.elements.serverUrl.value = this.defaultServerUrl;
            this.log(`自动配置服务器地址: ${this.defaultServerUrl}`, 'info');
        }
    }
    
    bindEvents() {
        // 连接控制事件
        this.elements.connectBtn.addEventListener('click', () => this.connect());
        this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());
        this.elements.refreshRoomsBtn.addEventListener('click', () => this.refreshRooms());
        
        // 视频控制事件
        this.elements.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
        this.elements.screenshotBtn.addEventListener('click', () => this.takeScreenshot());
        this.elements.recordBtn.addEventListener('click', () => this.toggleRecording());
        
        // 音频控制事件
        this.elements.muteBtn.addEventListener('click', () => this.toggleMute());
        this.elements.volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value));
        
        // 日志控制事件
        this.elements.clearLogBtn.addEventListener('click', () => this.clearLog());
        
        // 视频事件
        this.elements.remoteVideo.addEventListener('loadedmetadata', () => this.onVideoLoaded());
        this.elements.remoteVideo.addEventListener('play', () => this.onVideoPlay());
        
        // 键盘快捷键
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    }
    
    async connect() {
        const serverUrl = this.elements.serverUrl.value.trim();
        if (!serverUrl) {
            this.log('请输入信令服务器地址', 'error');
            return;
        }

        this.shouldReconnect = true;
        this.connectToServer(serverUrl);
    }
    
    connectToServer(serverUrl) {
        try {
            this.log(`正在连接到服务器: ${serverUrl} (尝试 ${this.reconnectAttempts + 1})`, 'info');
            this.updateConnectionStatus('connecting');
            
            this.websocket = new WebSocket(serverUrl);
            this.websocket.onopen = () => this.onWebSocketOpen();
            this.websocket.onmessage = (event) => this.onWebSocketMessage(event);
            this.websocket.onclose = (event) => this.onWebSocketClose(event);
            this.websocket.onerror = (error) => this.onWebSocketError(error);
            
        } catch (error) {
            this.log(`连接失败: ${error.message}`, 'error');
            this.updateConnectionStatus('disconnected');
            this.scheduleReconnect();
        }
    }
    
    async disconnect() {
        this.log('正在断开连接...', 'info');
        this.shouldReconnect = false;
        
        // 清理定时器
        this.clearTimers();
        
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
        
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
        
        this.isConnected = false;
        this.currentRoom = null;
        this.updateConnectionStatus('disconnected');
        this.updateWebRTCStatus('disconnected');
        this.resetUI();
        
        this.log('已断开连接', 'info');
    }
    
    onWebSocketOpen() {
        this.log('WebSocket连接已建立', 'success');
        this.updateConnectionStatus('connected');
        this.isConnected = true;
        const wasReconnecting = this.isReconnecting;
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        
        // 启动心跳
        this.startHeartbeat();
        
        // 注册为Web客户端
        this.registerClient();
        
        // 启用UI控件
        this.elements.connectBtn.disabled = true;
        this.elements.disconnectBtn.disabled = false;
        this.elements.refreshRoomsBtn.disabled = false;
        
        // 刷新可用房间
        this.refreshRooms();
        
        // 如果是重连且之前有房间连接，尝试重新加入
        if (this.currentRoom && wasReconnecting) {
            this.log(`重连后尝试重新加入房间: ${this.currentRoom}`, 'info');
            setTimeout(() => {
                this.joinRoom(this.currentRoom);
            }, 1000); // 延迟1秒确保服务器注册完成
        }
    }
    
    onWebSocketMessage(event) {
        try {
            const message = JSON.parse(event.data);
            
            // 处理心跳响应
            if (message.type === 'pong') {
                this.lastPongTime = Date.now();
                return;
            }
            
            this.handleSignalingMessage(message);
        } catch (error) {
            this.log(`解析消息失败: ${error.message}`, 'error');
        }
    }
    
    onWebSocketClose(event) {
        this.log(`WebSocket连接已关闭 (代码: ${event.code}, 原因: ${event.reason})`, 'warning');
        this.updateConnectionStatus('disconnected');
        this.isConnected = false;
        this.clearTimers();
        this.resetUI();
        
        // 自动重连
        if (this.shouldReconnect) {
            this.isReconnecting = true; // 标记为重连状态
            this.scheduleReconnect();
        }
    }
    
    onWebSocketError(error) {
        this.log(`WebSocket错误: ${error}`, 'error');
        this.updateConnectionStatus('disconnected');
    }
    
    registerClient() {
        const message = {
            type: 'register',
            clientType: 'web'
        };
        this.sendSignalingMessage(message);
        this.log('发送客户端注册请求', 'info');
    }
    
    async refreshRooms() {
        if (!this.isConnected) {
            this.log('请先连接到服务器', 'warning');
            return;
        }
        
        const message = {
            type: 'get_rooms'
        };
        this.sendSignalingMessage(message);
        this.log('刷新可用机器人列表', 'info');
    }
    
    async joinRoom(roomId) {
        if (!this.isConnected) {
            this.log('请先连接到服务器', 'warning');
            return;
        }
        
        this.currentRoom = roomId;
        const message = {
            type: 'join_room',
            roomId: roomId
        };
        this.sendSignalingMessage(message);
        this.log(`加入房间: ${roomId}`, 'info');
    }
    
    async handleSignalingMessage(message) {
        const { type } = message;
        
        switch (type) {
            case 'registered':
                this.localClientId = message.clientId;
                this.log(`客户端注册成功: ${this.localClientId}`, 'success');
                break;
                
            case 'available_rooms':
                this.updateRoomList(message.rooms);
                break;
                
            case 'room_joined':
                this.log(`已加入房间: ${message.roomId}`, 'success');
                this.currentRoom = message.roomId;
                // 检查房间状态
                if (message.roomStatus) {
                    if (!message.roomStatus.hasRobot) {
                        this.log('房间中没有机器人，等待机器人连接...', 'warning');
                    } else if (message.roomStatus.robotDisconnected) {
                        this.log('机器人暂时断线，等待重连...', 'warning');
                    }
                }
                break;
                
            case 'room_status':
                if (message.status === 'waiting_robot') {
                    this.log(`房间状态: ${message.message}`, 'warning');
                } else if (message.status === 'no_robot') {
                    this.log(`房间状态: ${message.message}`, 'error');
                    // 清空房间选择，让用户重新选择
                    this.elements.roomSelection.value = '';
                    this.refreshRooms();
                }
                break;
                
            case 'robot_disconnected':
                this.log(`机器人断开连接: ${message.message}`, 'warning');
                this.updateWebRTCStatus('waiting');
                // 保持连接，等待机器人重连
                break;
                
            case 'robot_reconnected':
                this.log(`机器人重连成功: ${message.message}`, 'success');
                // 机器人重连后，可能需要重新建立WebRTC连接
                if (this.peerConnection) {
                    this.peerConnection.close();
                }
                await this.setupWebRTC();
                await this.createOffer();
                break;
                
            case 'room_closed':
                this.log(`房间已关闭: ${message.message}`, 'error');
                this.updateWebRTCStatus('disconnected');
                this.currentRoom = null;
                this.elements.roomSelection.value = '';
                this.refreshRooms();
                break;
                
            case 'peer_joined':
                this.remoteClientId = message.peerId;
                let robotInfo = message.robotId ? ` (${message.robotId})` : '';
                this.log(`机器人已连接: ${this.remoteClientId}${robotInfo}`, 'success');
                await this.setupWebRTC();
                await this.createOffer();
                break;
                
            case 'answer':
                await this.handleAnswer(message);
                break;
                
            case 'ice_candidate':
                await this.handleIceCandidate(message);
                break;
                
            case 'peer_disconnected':
                this.log('机器人已断开连接', 'warning');
                this.updateWebRTCStatus('disconnected');
                break;
                
            case 'error':
                this.log(`服务器错误: ${message.message}`, 'error');
                break;
                
            default:
                this.log(`未知消息类型: ${type}`, 'warning');
        }
    }
    
    updateRoomList(rooms) {
        const select = this.elements.roomSelection;
        select.innerHTML = '<option value="">选择一个机器人</option>';
        
        if (rooms.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '没有可用的机器人';
            option.disabled = true;
            select.appendChild(option);
        } else {
            rooms.forEach(room => {
                const option = document.createElement('option');
                option.value = room.roomId;
                
                if (room.status === 'available') {
                    option.textContent = `✅ ${room.robotId} (房间: ${room.roomId})`;
                } else if (room.status === 'robot_disconnected' || room.status === 'disconnected') {
                    option.textContent = `⚠️ ${room.robotId || '机器人'} - 断线重连中 (房间: ${room.roomId})`;
                    option.style.color = '#ff9800';
                } else {
                    option.textContent = `${room.robotId} (房间: ${room.roomId})`;
                }
                
                // 如果当前选中的是这个房间，保持选中状态
                if (this.currentRoom === room.roomId) {
                    option.selected = true;
                }
                
                select.appendChild(option);
            });
            
            // 添加选择事件
            select.onchange = (e) => {
                if (e.target.value && e.target.value !== this.currentRoom) {
                    this.joinRoom(e.target.value);
                }
            };
        }
        
        // 统计可用和断线的机器人数量
        const available = rooms.filter(r => r.status === 'available').length;
        const disconnected = rooms.filter(r => r.status === 'robot_disconnected' || r.status === 'disconnected').length;
        
        let statusMsg = `找到 ${rooms.length} 个机器人`;
        if (available > 0) statusMsg += ` (${available} 个在线`;
        if (disconnected > 0) statusMsg += `, ${disconnected} 个断线重连中`;
        if (available > 0) statusMsg += ')';
        
        this.log(statusMsg, 'info');
    }
    
    async setupWebRTC() {
        try {
            // 创建RTCPeerConnection
            this.peerConnection = new RTCPeerConnection({
                iceServers: this.iceServers
            });
            
            // 设置事件处理器
            this.peerConnection.onicecandidate = (event) => this.onIceCandidate(event);
            this.peerConnection.ontrack = (event) => this.onTrack(event);
            this.peerConnection.onconnectionstatechange = () => this.onConnectionStateChange();
            this.peerConnection.oniceconnectionstatechange = () => this.onIceConnectionStateChange();
            
            this.log('WebRTC连接设置完成', 'info');
            
        } catch (error) {
            this.log(`WebRTC设置失败: ${error.message}`, 'error');
            throw error;
        }
    }
    
    async createOffer() {
        try {
            const offer = await this.peerConnection.createOffer({
                offerToReceiveVideo: true,
                offerToReceiveAudio: true
            });
            
            await this.peerConnection.setLocalDescription(offer);
            
            const message = {
                type: 'offer',
                sdp: offer.sdp
            };
            this.sendSignalingMessage(message);
            
            this.log('已发送WebRTC Offer', 'info');
            
        } catch (error) {
            this.log(`创建Offer失败: ${error.message}`, 'error');
        }
    }
    
    async handleAnswer(message) {
        try {
            const answer = new RTCSessionDescription({
                type: 'answer',
                sdp: message.sdp
            });
            
            await this.peerConnection.setRemoteDescription(answer);
            this.log('已设置远程描述 (Answer)', 'success');
            
        } catch (error) {
            this.log(`处理Answer失败: ${error.message}`, 'error');
        }
    }
    
    async handleIceCandidate(message) {
        try {
            const candidate = new RTCIceCandidate({
                candidate: message.candidate.candidate || '',
                sdpMLineIndex: message.candidate.sdpMLineIndex,
                sdpMid: message.candidate.sdpMid
            });
            
            await this.peerConnection.addIceCandidate(candidate);
            
        } catch (error) {
            this.log(`处理ICE候选失败: ${error.message}`, 'error');
        }
    }
    
    onIceCandidate(event) {
        if (event.candidate) {
            const message = {
                type: 'ice_candidate',
                candidate: {
                    candidate: event.candidate.candidate,
                    sdpMLineIndex: event.candidate.sdpMLineIndex,
                    sdpMid: event.candidate.sdpMid
                }
            };
            this.sendSignalingMessage(message);
        }
    }
    
    onTrack(event) {
        this.log('接收到远程媒体流', 'success');
        
        if (event.streams && event.streams[0]) {
            this.elements.remoteVideo.srcObject = event.streams[0];
            this.elements.videoOverlay.classList.add('hidden');
            this.updateWebRTCStatus('connected');
            
            // 启用视频控制按钮
            this.elements.fullscreenBtn.disabled = false;
            this.elements.screenshotBtn.disabled = false;
            this.elements.recordBtn.disabled = false;
            
            // 开始统计信息更新
            this.startStatsMonitoring();
        }
    }
    
    onConnectionStateChange() {
        const state = this.peerConnection.connectionState;
        this.log(`WebRTC连接状态: ${state}`, 'info');
        this.elements.statConnectionState.textContent = state;
        
        if (state === 'connected') {
            this.updateWebRTCStatus('connected');
        } else if (state === 'disconnected' || state === 'failed') {
            this.updateWebRTCStatus('disconnected');
            this.log('WebRTC连接失败，可能是网络问题或ICE连接失败', 'error');
        }
    }
    
    onIceConnectionStateChange() {
        const state = this.peerConnection.iceConnectionState;
        this.log(`ICE连接状态: ${state}`, 'info');
        this.elements.statIceState.textContent = state;
        
        // 添加详细的ICE状态处理
        switch(state) {
            case 'checking':
                this.log('正在检查ICE连接...', 'info');
                break;
            case 'connected':
                this.log('ICE连接成功建立', 'success');
                break;
            case 'completed':
                this.log('ICE连接完成', 'success');
                break;
            case 'failed':
                this.log('ICE连接失败 - 可能需要TURN服务器', 'error');
                break;
            case 'disconnected':
                this.log('ICE连接断开', 'warning');
                break;
            case 'closed':
                this.log('ICE连接已关闭', 'info');
                break;
        }
    }
    
    startStatsMonitoring() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }
        
        this.statsInterval = setInterval(async () => {
            if (this.peerConnection) {
                await this.updateStats();
            }
        }, 1000);
    }
    
    async updateStats() {
        try {
            const stats = await this.peerConnection.getStats();
            let inboundVideo = null;
            let inboundAudio = null;
            
            stats.forEach(report => {
                if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
                    inboundVideo = report;
                } else if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
                    inboundAudio = report;
                }
            });
            
            if (inboundVideo) {
                // 更新视频统计信息
                this.elements.statBandwidth.textContent = `${Math.round(inboundVideo.bytesReceived * 8 / 1024)} kbps`;
                this.elements.statFramerate.textContent = `${inboundVideo.framesPerSecond || 0} fps`;
                this.elements.videoFps.textContent = `${inboundVideo.framesPerSecond || 0} fps`;
                this.elements.videoBitrate.textContent = `${Math.round(inboundVideo.bytesReceived * 8 / 1024)} kbps`;
                
                if (inboundVideo.frameWidth && inboundVideo.frameHeight) {
                    this.elements.videoResolution.textContent = `${inboundVideo.frameWidth}x${inboundVideo.frameHeight}`;
                }
                
                // 计算丢包率
                if (inboundVideo.packetsLost !== undefined && inboundVideo.packetsReceived !== undefined) {
                    const totalPackets = inboundVideo.packetsLost + inboundVideo.packetsReceived;
                    const packetLossRate = totalPackets > 0 ? (inboundVideo.packetsLost / totalPackets * 100) : 0;
                    this.elements.statPacketLoss.textContent = `${packetLossRate.toFixed(2)}%`;
                }
            }
            
        } catch (error) {
            console.error('获取统计信息失败:', error);
        }
    }
    
    // UI控制方法
    toggleFullscreen() {
        const videoContainer = this.elements.remoteVideo.parentElement;
        
        if (!document.fullscreenElement) {
            videoContainer.requestFullscreen().catch(err => {
                this.log(`全屏模式失败: ${err.message}`, 'error');
            });
        } else {
            document.exitFullscreen();
        }
    }
    
    takeScreenshot() {
        const video = this.elements.remoteVideo;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        
        // 下载截图
        const link = document.createElement('a');
        link.download = `robot-screenshot-${new Date().toISOString()}.png`;
        link.href = canvas.toDataURL();
        link.click();
        
        this.log('截图已保存', 'success');
    }
    
    toggleRecording() {
        if (!this.isRecording) {
            this.startRecording();
        } else {
            this.stopRecording();
        }
    }
    
    startRecording() {
        const stream = this.elements.remoteVideo.srcObject;
        if (!stream) {
            this.log('没有可录制的视频流', 'error');
            return;
        }
        
        try {
            this.mediaRecorder = new MediaRecorder(stream);
            const chunks = [];
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                
                const link = document.createElement('a');
                link.download = `robot-recording-${new Date().toISOString()}.webm`;
                link.href = url;
                link.click();
                
                URL.revokeObjectURL(url);
                this.log('录制已保存', 'success');
            };
            
            this.mediaRecorder.start();
            this.isRecording = true;
            this.elements.recordBtn.textContent = '⏹️ 停止录制';
            this.elements.recordBtn.style.backgroundColor = '#F44336';
            this.log('开始录制视频', 'info');
            
        } catch (error) {
            this.log(`录制失败: ${error.message}`, 'error');
        }
    }
    
    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            this.elements.recordBtn.textContent = '🎥 录制';
            this.elements.recordBtn.style.backgroundColor = '';
            this.log('停止录制视频', 'info');
        }
    }
    
    toggleMute() {
        const video = this.elements.remoteVideo;
        video.muted = !video.muted;
        
        this.elements.muteBtn.textContent = video.muted ? '🔇 取消静音' : '🔊 静音';
        this.log(video.muted ? '已静音' : '已取消静音', 'info');
    }
    
    setVolume(value) {
        const video = this.elements.remoteVideo;
        video.volume = value / 100;
        this.elements.volumeDisplay.textContent = `${value}%`;
    }
    
    onVideoLoaded() {
        const video = this.elements.remoteVideo;
        this.log(`视频加载完成: ${video.videoWidth}x${video.videoHeight}`, 'success');
        this.elements.videoResolution.textContent = `${video.videoWidth}x${video.videoHeight}`;
    }
    
    onVideoPlay() {
        this.log('视频开始播放', 'success');
    }
    
    handleKeyboard(event) {
        // 键盘快捷键
        if (event.ctrlKey || event.metaKey) {
            switch (event.key) {
                case 'f':
                    event.preventDefault();
                    this.toggleFullscreen();
                    break;
                case 's':
                    event.preventDefault();
                    this.takeScreenshot();
                    break;
                case 'r':
                    event.preventDefault();
                    this.toggleRecording();
                    break;
            }
        }
    }
    
    // 辅助方法
    sendSignalingMessage(message) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify(message));
        } else {
            this.log('WebSocket连接不可用', 'error');
        }
    }
    
    updateConnectionStatus(status) {
        const statusElement = this.elements.connectionStatus;
        statusElement.className = `status ${status}`;
        
        switch (status) {
            case 'connected':
                statusElement.textContent = '已连接';
                break;
            case 'connecting':
                statusElement.textContent = '连接中';
                break;
            case 'disconnected':
                statusElement.textContent = '未连接';
                break;
        }
    }
    
    updateWebRTCStatus(status) {
        const statusElement = this.elements.webrtcStatus;
        statusElement.className = `status ${status}`;
        
        switch (status) {
            case 'connected':
                statusElement.textContent = 'WebRTC已连接';
                break;
            case 'connecting':
                statusElement.textContent = 'WebRTC连接中';
                break;
            case 'waiting':
                statusElement.textContent = 'WebRTC等待中';
                break;
            case 'disconnected':
                statusElement.textContent = 'WebRTC未连接';
                break;
            default:
                statusElement.textContent = `WebRTC ${status}`;
        }
    }
    
    resetUI() {
        this.elements.connectBtn.disabled = false;
        this.elements.disconnectBtn.disabled = true;
        this.elements.refreshRoomsBtn.disabled = true;
        this.elements.fullscreenBtn.disabled = true;
        this.elements.screenshotBtn.disabled = true;
        this.elements.recordBtn.disabled = true;
        
        this.elements.remoteVideo.srcObject = null;
        this.elements.videoOverlay.classList.remove('hidden');
        
        // 重置统计信息
        this.elements.statConnectionState.textContent = '-';
        this.elements.statIceState.textContent = '-';
        this.elements.statLatency.textContent = '- ms';
        this.elements.statPacketLoss.textContent = '- %';
        this.elements.statBandwidth.textContent = '- kbps';
        this.elements.statFramerate.textContent = '- fps';
        this.elements.videoResolution.textContent = '-';
        this.elements.videoFps.textContent = '- fps';
        this.elements.videoBitrate.textContent = '- kbps';
        
        // 重置房间选择
        this.elements.roomSelection.innerHTML = '<option value="">点击刷新获取可用机器人</option>';
    }
    
    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.innerHTML = `
            <span class="log-timestamp">[${timestamp}]</span> ${message}
        `;
        
        this.elements.logMessages.appendChild(logEntry);
        
        // 自动滚动到底部
        if (this.elements.autoScrollCheckbox.checked) {
            this.elements.logMessages.scrollTop = this.elements.logMessages.scrollHeight;
        }
        
        // 同时输出到控制台
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
    
    clearLog() {
        this.elements.logMessages.innerHTML = '';
        this.log('日志已清空', 'info');
    }
    
    // ==================== 心跳和重连机制 ====================
    
    startHeartbeat() {
        this.clearTimers();
        
        this.pingInterval = setInterval(() => {
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                this.sendSignalingMessage({ type: 'ping', timestamp: Date.now() });
                
                // 检查是否超时
                if (Date.now() - this.lastPongTime > 60000) { // 60秒超时
                    this.log('心跳超时，重新连接...', 'warning');
                    this.websocket.close();
                }
            }
        }, this.pingIntervalMs);
    }
    
    clearTimers() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    
    scheduleReconnect() {
        if (!this.shouldReconnect || this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.log('停止重连尝试', 'warning');
            return;
        }
        
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
        
        this.log(`${delay / 1000}秒后尝试重连...`, 'info');
        
        this.reconnectTimer = setTimeout(() => {
            if (this.shouldReconnect) {
                const serverUrl = this.elements.serverUrl.value.trim();
                this.connectToServer(serverUrl);
            }
        }, delay);
    }
    
    resetReconnect() {
        this.reconnectAttempts = 0;
        this.clearTimers();
    }
}

// 面板折叠功能
function togglePanel(contentId) {
    const content = document.getElementById(contentId);
    const panel = content.closest('.collapsible');
    panel.classList.toggle('collapsed');
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    const client = new RobotWebRTCClient();
    
    // 将客户端实例暴露到全局作用域，便于调试
    window.robotClient = client;
});

// 错误处理
window.addEventListener('error', (event) => {
    console.error('全局错误:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('未处理的Promise拒绝:', event.reason);
});
