# WebRTC机器人远程监控系统

这是一个基于WebRTC技术的机器人远程音视频监控系统，包含机器人端、Web客户端和信令服务器三个组件。

## 系统架构

### 新架构 - 集成服务器模式 (推荐)

```
机器人端 (NVIDIA ORIN NX)    ←→    集成服务器    ←→    用户浏览器
    ↓                              ↓                ↓  
Python + aiortc              Node.js + Web界面    直接访问无需安装
```

**优势：**
- ✅ 用户无需安装任何软件，直接浏览器访问
- ✅ 支持手机、平板、电脑等任何设备
- ✅ 统一管理和更新
- ✅ 降低部署复杂度

### 传统架构 - 分离模式

```
机器人端 (NVIDIA ORIN NX)    ←→    信令服务器 (Node.js)    ←→    Web客户端 (Browser)
    ↓                                   ↓                           ↓
Python + aiortc              WebSocket + Express            需要本地运行Web服务器
GStreamer硬件加速                信令中继服务                   用户需要安装Node.js
```

## 项目结构

```
webrtc_ws/
├── signaling-server/          # 集成服务器（信令 + Web客户端）
│   ├── package.json
│   ├── server.js             # 集成服务器主程序
│   ├── build.js              # Web客户端构建脚本
│   ├── public/               # Web客户端文件（自动生成）
│   │   ├── index.html
│   │   ├── styles.css
│   │   └── webrtc-client.js
│   └── README.md
├── robot-webrtc/             # 机器人端
│   ├── requirements.txt      # Python依赖
│   ├── robot_client.py       # 机器人WebRTC客户端
│   ├── setup_orin.sh         # ORIN NX安装脚本
│   └── README.md
├── install.bat               # Windows安装脚本
├── start-integrated.bat      # Windows启动脚本
├── start-integrated.sh       # Linux/Mac启动脚本
├── cleanup-web-client.bat    # 清理旧web-client目录
└── README.md                 # 项目说明文档
```

**注意**: `web-client/` 目录已被集成到 `signaling-server/` 中，可以安全删除。

## 快速开始

### 方式一：集成服务器部署 (推荐)

**只需一个服务器，用户通过浏览器访问，无需本地安装**

#### Windows:
```bash
start-integrated.bat
```

#### Linux/Mac:
```bash
chmod +x start-integrated.sh
./start-integrated.sh
```

#### 访问方式:
1. 服务器启动后访问: `http://localhost:3001`
2. 配置机器人端: `python robot_client.py --server ws://localhost:3001`
3. 用户只需浏览器访问服务器IP即可

### 方式二：手动启动 (开发模式)

1. **启动集成服务器**:
```bash
cd signaling-server
npm install
npm run build  # 构建Web客户端到服务器
npm start
```

2. **配置机器人端** (在NVIDIA ORIN NX上):
```bash
cd robot-webrtc
chmod +x setup_orin.sh
./setup_orin.sh
source venv/bin/activate
python robot_client.py --server ws://服务器IP:3001
```

### 方式三：Docker部署
```bash
docker-compose up -d
```

### 方式四：机器人端集成部署

在机器人端同时运行服务器和机器人客户端：

```bash
cd robot-webrtc
chmod +x setup_integrated_server.sh
./setup_integrated_server.sh
```

然后用户可以直接访问机器人的IP地址查看视频流。

## 通信链路分析

### 局域网连接模式

**优势：**
- 延迟低 (10-50ms)
- 带宽充足，支持高清视频 (1080p@30fps)
- 无需外部STUN/TURN服务器
- 连接稳定，丢包率低

**配置：**
```javascript
// 仅需要基本的STUN服务器
iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
]
```

**网络拓扑：**
```
机器人 (192.168.1.100) ←→ 路由器 ←→ 电脑 (192.168.1.101)
           ↓                                    ↓
    直接P2P连接                          无需NAT穿透
```

### 外网连接模式

**挑战：**
- NAT穿透困难
- 延迟较高 (100-500ms)
- 可能需要中继传输
- 带宽限制

**解决方案：**
```javascript
// 需要完整的STUN/TURN配置
iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { 
        urls: 'turn:coturn.example.com:3478',
        username: 'user',
        credential: 'pass'
    }
]
```

**网络拓扑：**
```
机器人 ←→ NAT/防火墙 ←→ 互联网 ←→ NAT/防火墙 ←→ 电脑
   ↓                      ↓                     ↓
STUN发现公网IP        TURN中继服务器        P2P或中继连接
```

## 性能优化建议

### 机器人端优化 (NVIDIA ORIN NX)

1. **硬件加速编码**
```python
# 使用NVIDIA硬件编码器
pipeline = (
    "nvarguscamerasrc ! "
    "video/x-raw(memory:NVMM), width=1280, height=720, framerate=30/1 ! "
    "nvv4l2h264enc bitrate=2000000 ! "
    "h264parse ! rtph264pay ! udpsink"
)
```

2. **系统性能调优**
```bash
# 最大性能模式
sudo nvpmodel -m 0
sudo jetson_clocks

# 网络缓冲区优化
echo 'net.core.rmem_max = 134217728' >> /etc/sysctl.conf
echo 'net.core.wmem_max = 134217728' >> /etc/sysctl.conf
```

### Web客户端优化

1. **自适应码率**
2. **连接质量监控**
3. **错误恢复机制**

## 部署方案

### 开发环境部署

1. **本地测试环境**
```bash
# 启动所有服务
./start-dev.sh
```

2. **局域网测试**
- 信令服务器部署在局域网可访问的机器上
- 机器人和Web客户端配置相同的服务器地址

### 生产环境部署

1. **云服务器部署**
```bash
# 使用Docker容器化部署
docker-compose up -d
```

2. **HTTPS配置**
- WebRTC要求HTTPS环境
- 配置SSL证书
- 反向代理设置

## 安全考虑

### 认证与授权
- 实现房间密码保护
- 用户身份验证
- 访问权限控制

### 网络安全
- DTLS加密传输
- 信令服务器SSL/TLS
- 防止未授权访问

## 故障排除

### 常见问题

1. **摄像头无法访问**
```bash
# 检查摄像头权限
ls -la /dev/video*
sudo usermod -a -G video $USER
```

2. **WebRTC连接失败**
- 检查防火墙设置
- 验证STUN/TURN服务器
- 查看浏览器控制台日志

3. **音频问题**
```bash
# 检查音频设备
arecord -l
pulseaudio --check
```

### 日志分析

**机器人端日志：**
```bash
# 启用详细日志
export AIORTC_LOG_LEVEL=DEBUG
python robot_client.py
```

**Web客户端日志：**
- 浏览器开发者工具 → Console
- Network面板查看WebSocket连接

## 扩展功能

### 计划功能
- [ ] 多机器人同时连接
- [ ] 云端录像存储
- [ ] 移动端APP支持
- [ ] AI视频分析
- [ ] 双向音频通话
- [ ] 遥控指令传输

### 自定义开发
- 插件系统设计
- API接口扩展
- 第三方集成

## 技术支持

- 查看各模块的README文档
- 提交Issue到GitHub仓库
- 参考WebRTC官方文档

## 许可证

MIT License - 详见LICENSE文件
