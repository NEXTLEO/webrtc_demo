#!/bin/bash

# NVIDIA ORIN NX WebRTC机器人端安装脚本
# Ubuntu 22.04

echo "=== NVIDIA ORIN NX WebRTC机器人端环境配置 ==="

# 更新系统
sudo apt update
sudo apt upgrade -y

# 安装基础依赖
sudo apt install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    cmake \
    pkg-config \
    libssl-dev \
    libffi-dev \
    python3-dev

# 安装GStreamer (NVIDIA硬件加速支持)
sudo apt install -y \
    gstreamer1.0-tools \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-ugly \
    gstreamer1.0-libav \
    libgstreamer1.0-dev \
    libgstreamer-plugins-base1.0-dev \
    libgstreamer-plugins-bad1.0-dev

# 安装OpenCV依赖
sudo apt install -y \
    libopencv-dev \
    python3-opencv \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libavcodec-dev \
    libavformat-dev \
    libswscale-dev \
    libv4l-dev \
    libxvidcore-dev \
    libx264-dev

# 安装音频依赖
sudo apt install -y \
    libasound2-dev \
    portaudio19-dev \
    pulseaudio \
    alsa-utils

# 创建Python虚拟环境
python3 -m venv venv
source venv/bin/activate

# 升级pip
pip install --upgrade pip

# 安装Python依赖
pip install -r requirements.txt

# 检查摄像头设备
echo "=== 检查摄像头设备 ==="
ls -la /dev/video*

# 检查音频设备
echo "=== 检查音频设备 ==="
arecord -l

# 测试摄像头 (CSI摄像头)
echo "=== 测试CSI摄像头 (如果存在) ==="
if [ -e /dev/video0 ]; then
    echo "摄像头设备 /dev/video0 已找到"
    v4l2-ctl --device=/dev/video0 --list-formats-ext
else
    echo "未找到摄像头设备"
fi

# 设置权限
sudo usermod -a -G video $USER
sudo usermod -a -G audio $USER

echo "=== 安装完成 ==="
echo "请重新登录以应用用户组权限更改"
echo "然后运行: source venv/bin/activate && python robot_client.py"
