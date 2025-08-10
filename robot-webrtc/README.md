# WebRTC机器人端配置

## 硬件要求
- NVIDIA ORIN NX
- Ubuntu 22.04
- USB摄像头或CSI摄像头
- 麦克风设备

## 安装步骤

### 1. 运行安装脚本
```bash
chmod +x setup_orin.sh
./setup_orin.sh
```

### 2. 激活虚拟环境
```bash
source venv/bin/activate
```

### 3. 启动机器人客户端
```bash
python robot_client.py --server ws://YOUR_SERVER_IP:3001
```

## 配置选项

### 命令行参数
- `--server`: 信令服务器地址 (默认: ws://localhost:3001)
- `--robot-id`: 机器人唯一标识符
- `--camera`: 摄像头设备ID (默认: 0)
- `--no-audio`: 禁用音频传输

### 示例启动命令
```bash
# 基础启动
python robot_client.py

# 指定服务器和机器人ID
python robot_client.py --server ws://192.168.1.100:3001 --robot-id "robot_001"

# 使用不同摄像头设备
python robot_client.py --camera 1

# 禁用音频
python robot_client.py --no-audio
```

## 摄像头配置

### CSI摄像头 (推荐用于ORIN NX)
如果使用CSI摄像头，需要修改代码中的GStreamer管道：

```python
def _get_gstreamer_pipeline(self) -> str:
    """CSI摄像头GStreamer管道"""
    pipeline = (
        f"nvarguscamerasrc sensor-id={self.device_id} ! "
        f"video/x-raw(memory:NVMM), width={self.width}, height={self.height}, "
        f"framerate={self.fps}/1, format=NV12 ! "
        "nvvidconv ! video/x-raw, format=BGRx ! "
        "videoconvert ! video/x-raw, format=BGR ! appsink drop=1"
    )
    return pipeline
```

### USB摄像头
默认使用OpenCV接口，支持大多数USB摄像头。

## 性能优化

### 1. 硬件加速编码
- 启用NVIDIA GPU加速
- 使用GStreamer硬件编码器

### 2. 网络优化
- 调整视频编码参数
- 配置适当的帧率和分辨率

### 3. 系统优化
```bash
# 设置CPU性能模式
sudo nvpmodel -m 0
sudo jetson_clocks

# 增加内存缓冲区
echo 'net.core.rmem_max = 134217728' | sudo tee -a /etc/sysctl.conf
echo 'net.core.wmem_max = 134217728' | sudo tee -a /etc/sysctl.conf
```

## 故障排除

### 摄像头问题
```bash
# 检查摄像头设备
ls -la /dev/video*
v4l2-ctl --list-devices

# 测试摄像头
ffmpeg -f v4l2 -i /dev/video0 -t 10 -y test.mp4
```

### 音频问题
```bash
# 检查音频设备
arecord -l
aplay -l

# 测试麦克风
arecord -D plughw:0,0 -f cd test.wav
```

### 网络连接问题
```bash
# 检查网络连接
ping google.com
netstat -an | grep 3001
```

## 日志和调试

启用详细日志：
```bash
export AIORTC_LOG_LEVEL=DEBUG
python robot_client.py
```

查看系统资源使用：
```bash
htop
iotop
```
