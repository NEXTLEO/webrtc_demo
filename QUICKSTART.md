# 🤖 WebRTC机器人远程监控系统

## ✨ 最新更新：集成服务器模式

现在支持**一键部署**，用户只需浏览器访问，无需安装任何客户端软件！

## 🚀 快速体验

### Windows用户
1. 双击运行 `install.bat` (首次安装)
2. 双击运行 `start-integrated.bat`
3. 浏览器访问 `http://localhost:3001`

### Linux/Mac用户
```bash
chmod +x start-integrated.sh
./start-integrated.sh
```

### 机器人端配置
```bash
cd robot-webrtc
python robot_client.py --server ws://服务器IP:3001
```

## 📱 支持的设备

- 💻 Windows/Mac/Linux电脑
- 📱 Android/iOS手机
- 📟 平板电脑
- 🌐 任何支持现代浏览器的设备

## 🏗️ 架构对比

| 模式 | 用户体验 | 部署复杂度 | 设备支持 | 推荐度 |
|------|----------|------------|----------|--------|
| **集成服务器** | 浏览器直接访问 | 简单 | 全平台 | ⭐⭐⭐⭐⭐ |
| 分离模式 | 需要本地安装 | 复杂 | 有限 | ⭐⭐⭐ |

## 🌟 主要特性

- 🎥 **实时视频流**：支持1080p@30fps
- 🔊 **双向音频**：清晰的音频传输
- 📷 **截图录制**：一键截图和视频录制
- 📊 **状态监控**：实时连接状态和质量统计
- 🔧 **硬件加速**：NVIDIA GPU加速编码
- 🌐 **跨平台**：支持任何现代浏览器

## 📋 部署场景

### 场景1：企业内网监控
```
服务器部署 → 员工浏览器访问 → 查看机器人状态
```

### 场景2：远程技术支持
```
技术人员电脑 → 互联网 → 客户现场机器人
```

### 场景3：教育演示
```
教室投影仪 → 无线网络 → 实验室机器人
```

## 🛠️ 技术栈

- **后端**: Node.js + Express + WebSocket
- **前端**: 原生JavaScript + WebRTC
- **机器人端**: Python + aiortc + OpenCV
- **硬件加速**: NVIDIA GStreamer + CUDA

## 📞 技术支持

- 📖 详细文档：查看 `DEPLOYMENT.md`
- 🔧 故障排除：查看各模块README
- 🌐 API文档：访问 `/api/health` 和 `/api/stats`

---

**开始使用只需要2步：**
1. 运行服务器：`start-integrated.bat`
2. 打开浏览器：`http://localhost:3001`

就这么简单！🎉
