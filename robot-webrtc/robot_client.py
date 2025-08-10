#!/usr/bin/env python3
"""
WebRTC Robot Camera Streaming
适用于NVIDIA ORIN NX, Ubuntu 22.04
"""

import asyncio
import json
import logging
import uuid
import cv2
import numpy as np
import os
import subprocess
from typing import Optional, Dict, Any
import websockets
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack, MediaStreamTrack, RTCIceCandidate
from aiortc.contrib.media import MediaPlayer
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class CameraVideoTrack(VideoStreamTrack):
    """自定义视频轨道，优先支持CSI摄像头，其次USB摄像头，最后虚拟视频"""
    
    kind = "video"
    
    def __init__(self, device_id: int = 0, width: int = 1280, height: int = 720, fps: int = 30, use_dummy: bool = False):
        super().__init__()
        self.device_id = device_id
        self.width = width
        self.height = height
        self.fps = fps
        self.use_dummy = use_dummy
        self._cap = None
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._pts_generator = self._generate_pts()
        self._setup_camera()
    
    def _generate_pts(self):
        """生成时间戳"""
        pts = 0
        time_base = Fraction(1, 90000)
        frame_duration = Fraction(1, self.fps) / time_base
        while True:
            yield pts
            pts += int(frame_duration)
    
    def _setup_camera(self):
        """设置摄像头 - 优先CSI，其次USB，最后虚拟"""
        if self.use_dummy:
            logger.info("使用虚拟摄像头模式 (强制)")
            return
            
        # 1. 尝试CSI摄像头（NVIDIA ORIN NX）
        if self._try_csi_camera():
            return
            
        # 2. 尝试USB摄像头
        if self._try_usb_camera():
            return
            
        # 3. 回退到虚拟摄像头
        logger.warning("未检测到可用摄像头，使用虚拟摄像头")
        self.use_dummy = True
    
    def _try_csi_camera(self) -> bool:
        """尝试CSI摄像头"""
        try:
            # 检查是否在NVIDIA平台
            if not os.path.exists('/proc/device-tree/model'):
                return False
                
            # 检测nvarguscamerasrc是否可用
            result = subprocess.run([
                "gst-launch-1.0", "nvarguscamerasrc", "sensor-id=0",
                "!", "video/x-raw(memory:NVMM),width=1280,height=720,framerate=30/1",
                "!", "nvvidconv", "!", "video/x-raw,format=BGRx",
                "!", "videoconvert", "!", "video/x-raw,format=BGR",
                "!", "fakesink", "num-buffers=3"
            ], capture_output=True, timeout=10)
            
            if result.returncode == 0:
                # 构建GStreamer管道
                pipeline = (
                    f"nvarguscamerasrc sensor-id={self.device_id} ! "
                    f"video/x-raw(memory:NVMM), width={self.width}, height={self.height}, "
                    f"framerate={self.fps}/1, format=NV12 ! "
                    "nvvidconv ! video/x-raw, format=BGRx ! "
                    "videoconvert ! video/x-raw, format=BGR ! appsink drop=1"
                )
                self._cap = cv2.VideoCapture(pipeline, cv2.CAP_GSTREAMER)
                
                if self._cap and self._cap.isOpened():
                    logger.info("✅ 使用CSI摄像头 (nvarguscamerasrc)")
                    return True
                    
        except Exception as e:
            logger.debug(f"CSI摄像头尝试失败: {e}")
        
        return False
    
    def _try_usb_camera(self) -> bool:
        """尝试USB摄像头"""
        for device_id in range(4):
            try:
                if not os.path.exists(f"/dev/video{device_id}"):
                    continue
                    
                cap = cv2.VideoCapture(device_id)
                if cap and cap.isOpened():
                    # 尝试读取一帧验证摄像头工作
                    ret, frame = cap.read()
                    if ret and frame is not None:
                        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
                        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
                        cap.set(cv2.CAP_PROP_FPS, self.fps)
                        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc('M', 'J', 'P', 'G'))
                        
                        self._cap = cap
                        logger.info(f"✅ 使用USB摄像头 /dev/video{device_id}")
                        return True
                        
                if cap:
                    cap.release()
                    
            except Exception as e:
                logger.debug(f"USB摄像头 {device_id} 失败: {e}")
                
        return False
    
    def _get_gstreamer_pipeline(self) -> str:
        """
        为NVIDIA ORIN NX构建GStreamer管道
        使用硬件加速编码
        """
        pipeline = (
            f"nvarguscamerasrc sensor-id={self.device_id} ! "
            f"video/x-raw(memory:NVMM), width={self.width}, height={self.height}, "
            f"framerate={self.fps}/1, format=NV12 ! "
            "nvvidconv ! video/x-raw, format=BGRx ! "
            "videoconvert ! video/x-raw, format=BGR ! appsink drop=1"
        )
        return pipeline
    
    async def recv(self):
        """异步接收视频帧"""
        loop = asyncio.get_event_loop()
        frame = await loop.run_in_executor(self._executor, self._capture_frame)
        
        if frame is None:
            # 生成虚拟视频帧
            frame = self._generate_dummy_frame()
        
        # 转换为WebRTC兼容的格式
        from av import VideoFrame
        av_frame = VideoFrame.from_ndarray(frame, format='bgr24')
        av_frame.pts = next(self._pts_generator)
        av_frame.time_base = Fraction(1, 90000)
        
        return av_frame
    
    def _capture_frame(self):
        """捕获摄像头帧"""
        if self.use_dummy:
            return None  # 使用虚拟帧
            
        if self._cap is None or not self._cap.isOpened():
            return None
        
        ret, frame = self._cap.read()
        if ret and frame is not None:
            # 确保帧尺寸正确
            if frame.shape[1] != self.width or frame.shape[0] != self.height:
                frame = cv2.resize(frame, (self.width, self.height))
            return frame
        return None
    
    def _generate_dummy_frame(self):
        """生成高效虚拟视频帧"""
        # 创建渐变背景
        frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        
        # 时间偏移用于动画
        t = time.time()
        
        # 水平色相渐变
        for y in range(self.height):
            intensity = int(255 * y / self.height)
            frame[y, :] = [intensity // 3, intensity // 2, intensity]
        
        # 添加时间戳和状态信息
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        cv2.putText(frame, f"Robot Camera - {timestamp}", 
                   (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
        
        cv2.putText(frame, f"Resolution: {self.width}x{self.height}@{self.fps}fps", 
                   (50, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)
        
        # 移动指示器
        x = int(50 + 200 * (0.5 + 0.5 * np.sin(t)))
        y = int(200 + 50 * (0.5 + 0.5 * np.cos(t * 2)))
        cv2.circle(frame, (x, y), 20, (0, 255, 0), -1)
        
        return frame
    
    def cleanup(self):
        """清理资源"""
        if self._cap:
            self._cap.release()
        self._executor.shutdown(wait=True)


class MicrophoneAudioTrack(MediaStreamTrack):
    """自定义音频轨道，从麦克风获取音频流"""
    
    def __init__(self):
        super().__init__()
        self.kind = "audio"
        self.audio_track = None
        # 尝试不同的音频源
        self._setup_audio()
    
    def _setup_audio(self):
        """设置音频源"""
        audio_sources = [
            ('pulse', 'default'),  # PulseAudio
            ('alsa', 'default'),   # ALSA
            ('alsa', 'hw:0'),      # 硬件设备
        ]
        
        for format_name, device in audio_sources:
            try:
                player = MediaPlayer(device, format=format_name)
                if player.audio:
                    self.audio_track = player.audio
                    logger.info(f"音频初始化成功: {format_name}:{device}")
                    return
            except Exception as e:
                logger.debug(f"音频源 {format_name}:{device} 失败: {e}")
        
        logger.warning("音频初始化失败，将忽略音频轨道")
    
    async def recv(self):
        """接收音频帧"""
        if self.audio_track:
            try:
                return await self.audio_track.recv()
            except Exception as e:
                logger.debug(f"音频接收失败: {e}")
        return None


class RobotWebRTCClient:
    """机器人WebRTC客户端"""
    
    def __init__(self, 
                 signaling_server_url: str = "ws://123.56.125.236:3001",
                 robot_id: str = None,
                 camera_device: int = 0,
                 enable_audio: bool = True):
        
        self.signaling_server_url = signaling_server_url
        self.robot_id = robot_id or f"robot_{uuid.uuid4().hex[:8]}"
        self.camera_device = camera_device
        self.enable_audio = enable_audio
        
        self.websocket: Optional[websockets.WebSocketServerProtocol] = None
        self.peer_connection: Optional[RTCPeerConnection] = None
        self.video_track: Optional[CameraVideoTrack] = None
        self.audio_track: Optional[MicrophoneAudioTrack] = None
        
        self.client_id: Optional[str] = None
        self.room_id: str = f"room_{self.robot_id}"
        
        # 重连配置
        self.reconnect_enabled = True
        self.max_reconnect_attempts = 10
        self.reconnect_delay = 5
        self.current_reconnect_attempts = 0
        
        # ICE服务器配置 - 强制本地连接模式用于测试
        self.ice_servers = [
            # 禁用STUN服务器，强制host候选者连接
            # {"urls": "stun:stun.l.google.com:19302"},
            # {"urls": "stun:stun1.l.google.com:19302"},
            # {"urls": "stun:stun2.l.google.com:19302"},
            # {"urls": "stun:stun.cloudflare.com:3478"},
            # {"urls": "stun:openrelay.metered.ca:80"}
        ]
        
        logger.info(f"机器人客户端初始化: {self.robot_id}")
    
    async def start(self):
        """启动WebRTC客户端（带重连机制）"""
        # 启动前做网络测试
        await self._test_network_connectivity()
        
        while self.reconnect_enabled:
            try:
                await self._connect_signaling_server()
                await self._setup_webrtc()
                await self._register_client()
                await self._join_room()
                
                logger.info("WebRTC客户端启动成功，等待Web客户端连接...")
                
                # 重置重连计数器
                self.current_reconnect_attempts = 0
                
                # 保持连接
                await self._keep_alive()
                
            except websockets.exceptions.ConnectionClosed:
                logger.warning("WebSocket连接已断开")
                await self._handle_reconnection()
            except Exception as e:
                logger.error(f"启动失败: {e}")
                await self._handle_reconnection()
                
        logger.info("重连已禁用，客户端停止运行")
        await self.cleanup()
    
    async def _test_network_connectivity(self):
        """测试网络连接"""
        try:
            import socket
            
            # 获取本机IP地址
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            
            logger.info(f"🌐 本机IP地址: {local_ip}")
            
            # 检查是否能创建UDP socket
            udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            udp_socket.bind(('', 0))
            test_port = udp_socket.getsockname()[1]
            udp_socket.close()
            
            logger.info(f"✅ UDP端口测试成功: {test_port}")
            
        except Exception as e:
            logger.warning(f"⚠️  网络连接测试失败: {e}")
    
    async def _connect_signaling_server(self):
        """连接信令服务器"""
        max_retries = 3
        retry_delay = 5
        
        for attempt in range(max_retries):
            try:
                logger.info(f"尝试连接信令服务器 (第{attempt + 1}次): {self.signaling_server_url}")
                self.websocket = await websockets.connect(
                    self.signaling_server_url,
                    ping_interval=20,
                    ping_timeout=10,
                    open_timeout=10
                )
                logger.info(f"已成功连接到信令服务器: {self.signaling_server_url}")
                return
            except Exception as e:
                logger.error(f"连接信令服务器失败 (第{attempt + 1}次): {e}")
                if attempt < max_retries - 1:
                    logger.info(f"等待 {retry_delay} 秒后重试...")
                    await asyncio.sleep(retry_delay)
                else:
                    logger.error(f"所有连接尝试都失败了。请检查:")
                    logger.error(f"1. 服务器地址是否正确: {self.signaling_server_url}")
                    logger.error(f"2. 服务器是否正在运行")
                    logger.error(f"3. 网络连接是否正常")
                    logger.error(f"4. 防火墙是否阻止了连接")
                    raise
    
    async def _handle_reconnection(self):
        """处理重连逻辑"""
        if not self.reconnect_enabled:
            return
            
        self.current_reconnect_attempts += 1
        
        if self.current_reconnect_attempts > self.max_reconnect_attempts:
            logger.error(f"已达到最大重连次数 ({self.max_reconnect_attempts})，停止重连")
            self.reconnect_enabled = False
            return
        
        logger.info(f"准备重连 (第{self.current_reconnect_attempts}次)，等待 {self.reconnect_delay} 秒...")
        await asyncio.sleep(self.reconnect_delay)
        
        # 清理当前连接
        await self._cleanup_connections()
        
        logger.info(f"开始重连尝试 {self.current_reconnect_attempts}/{self.max_reconnect_attempts}")
    
    async def _cleanup_connections(self):
        """清理连接但不清理摄像头资源"""
        try:
            # 清理连接超时任务
            if hasattr(self, 'connection_timeout') and self.connection_timeout:
                self.connection_timeout.cancel()
                self.connection_timeout = None
            
            # 关闭peer连接前等待一小段时间让异步任务完成
            if self.peer_connection:
                try:
                    await asyncio.sleep(0.1)  # 给异步任务一点时间完成
                    await self.peer_connection.close()
                except Exception as e:
                    logger.warning(f"关闭peer连接时出错: {e}")
                finally:
                    self.peer_connection = None
            
            if self.websocket:
                try:
                    await self.websocket.close()
                except Exception as e:
                    logger.warning(f"关闭WebSocket时出错: {e}")
                finally:
                    self.websocket = None
                
            # 重置客户端ID，需要重新注册
            self.client_id = None
            
            # 额外等待让底层清理完成
            await asyncio.sleep(0.2)
            
        except Exception as e:
            logger.warning(f"清理连接时出错: {e}")
    
    async def _reset_peer_connection(self):
        """重置WebRTC peer连接，准备接受新的连接"""
        try:
            logger.info("重置WebRTC连接...")
            
            # 取消连接超时任务
            if hasattr(self, 'connection_timeout') and self.connection_timeout:
                self.connection_timeout.cancel()
                self.connection_timeout = None
            
            # 关闭当前peer连接
            if self.peer_connection:
                try:
                    await asyncio.sleep(0.1)  # 给异步任务时间完成
                    await self.peer_connection.close()
                except Exception as e:
                    logger.warning(f"关闭peer连接时出错: {e}")
                finally:
                    self.peer_connection = None
            
            # 等待底层清理完成
            await asyncio.sleep(0.2)
            
            # 重新设置WebRTC连接（但保持摄像头和信令服务器连接）
            await self._setup_webrtc()
            
            logger.info("WebRTC连接已重置，等待新的Web客户端连接...")
            
        except Exception as e:
            logger.error(f"重置WebRTC连接失败: {e}")
    
    async def _setup_webrtc(self):
        """设置WebRTC连接"""
        # 创建RTCPeerConnection
        from aiortc import RTCConfiguration, RTCIceServer
        
        # 尝试多个不同的ICE服务器配置
        ice_servers = [
            # Google STUN服务器
            RTCIceServer(urls="stun:stun.l.google.com:19302"),
            RTCIceServer(urls="stun:stun1.l.google.com:19302"),
            # 免费TURN服务器
            RTCIceServer(urls="turn:relay1.expressturn.com:3478", username="efJ4TENP8T3G4QGK6E", credential="fdFpA8iVTqbZeYXA"),
            RTCIceServer(urls="turn:openrelay.metered.ca:80", username="openrelayproject", credential="openrelayproject"),
            RTCIceServer(urls="turn:openrelay.metered.ca:443", username="openrelayproject", credential="openrelayproject"),
            RTCIceServer(urls="turn:openrelay.metered.ca:443?transport=tcp", username="openrelayproject", credential="openrelayproject"),
        ]
        
        configuration = RTCConfiguration(
            iceServers=ice_servers
            # aiortc不支持iceTransportPolicy等高级配置选项
        )
        
        self.peer_connection = RTCPeerConnection(configuration)
        
        # 设置事件处理器
        self.peer_connection.on("connectionstatechange", self._on_connection_state_change)
        self.peer_connection.on("icecandidate", self._on_ice_candidate)
        self.peer_connection.on("icegatheringstatechange", self._on_ice_gathering_state_change)
        self.peer_connection.on("iceconnectionstatechange", self._on_ice_connection_state_change)
        
        # 连接超时检测
        self.connection_timeout = None
        self.connection_timeout_duration = 30  # 30秒超时
        
        # 重新创建或使用现有的视频轨道
        if not self.video_track:
            self.video_track = CameraVideoTrack(
                device_id=self.camera_device,
                width=1280,
                height=720,
                fps=30
            )
        
        self.peer_connection.addTrack(self.video_track)
        
        # 创建音频轨道（如果启用且尚未创建）
        if self.enable_audio and not self.audio_track:
            try:
                self.audio_track = MicrophoneAudioTrack()
                if self.audio_track.audio_track:  # 只有在音频初始化成功时才添加
                    self.peer_connection.addTrack(self.audio_track)
                    logger.info("音频轨道已添加")
                else:
                    logger.info("音频初始化失败，跳过音频轨道")
                    self.audio_track = None
            except Exception as e:
                logger.warning(f"音频初始化失败: {e}")
                self.audio_track = None
        elif self.enable_audio and self.audio_track and self.audio_track.audio_track:
            # 重新添加现有的音频轨道
            try:
                self.peer_connection.addTrack(self.audio_track)
                logger.info("音频轨道已重新添加")
            except Exception as e:
                logger.warning(f"重新添加音频轨道失败: {e}")
        
        logger.info("WebRTC连接设置完成")
    
    async def _register_client(self):
        """注册客户端"""
        message = {
            "type": "register",
            "clientType": "robot",
            "robotId": self.robot_id
        }
        await self.websocket.send(json.dumps(message))
        logger.info("客户端注册请求已发送")
    
    async def _join_room(self):
        """加入房间"""
        message = {
            "type": "join_room",
            "roomId": self.room_id
        }
        await self.websocket.send(json.dumps(message))
        logger.info(f"房间加入请求已发送: {self.room_id}")
    
    async def _handle_signaling_message(self, message: Dict[str, Any]):
        """处理信令消息"""
        msg_type = message.get("type")
        
        if msg_type == "registered":
            self.client_id = message.get("clientId")
            logger.info(f"客户端注册成功: {self.client_id}")
        
        elif msg_type == "room_joined":
            logger.info(f"已加入房间: {message.get('roomId')}")
        
        elif msg_type == "peer_joined":
            logger.info("Web客户端已连接，等待接收offer...")
            # 不主动创建offer，等待Web客户端发送offer
        
        elif msg_type == "offer":
            await self._handle_offer(message)
        
        elif msg_type == "answer":
            await self._handle_answer(message)
        
        elif msg_type == "ice_candidate":
            await self._handle_ice_candidate(message)
        
        elif msg_type == "peer_disconnected":
            logger.info("对等端已断开连接，准备接受新连接...")
            await self._reset_peer_connection()
        
        elif msg_type == "error":
            logger.error(f"信令错误: {message.get('message')}")
    
    async def _create_and_send_offer(self):
        """主动创建并发送offer"""
        try:
            logger.info("🚀 开始创建WebRTC offer...")
            
            # 创建offer
            offer = await self.peer_connection.createOffer()
            
            # 设置本地描述
            await self.peer_connection.setLocalDescription(offer)
            logger.info("✅ 已设置本地描述 (offer)")
            
            # 发送offer给Web客户端
            offer_message = {
                "type": "offer",
                "sdp": offer.sdp
            }
            
            await self.websocket.send(json.dumps(offer_message))
            logger.info("📤 已发送offer到Web客户端")
            
        except Exception as e:
            logger.error(f"❌ 创建或发送offer失败: {e}")
    
    async def _handle_offer(self, message: Dict[str, Any]):
        """处理offer - 修复WebRTC direction问题"""
        try:
            offer = RTCSessionDescription(
                sdp=message["sdp"],
                type=message["type"]
            )
            
            await self.peer_connection.setRemoteDescription(offer)
            logger.info("已设置远程描述 (offer)")
            
            # 关键修复：强制设置所有transceiver的direction属性以避免None值错误
            for transceiver in self.peer_connection.getTransceivers():
                if transceiver.kind == "video":
                    # 强制设置video transceiver为sendonly（机器人发送视频）
                    transceiver._direction = "sendonly"
                    if hasattr(transceiver, '_offerDirection'):
                        transceiver._offerDirection = "recvonly"
                    else:
                        setattr(transceiver, '_offerDirection', "recvonly")
                    logger.info("修复video transceiver direction")
                elif transceiver.kind == "audio":
                    # 根据是否有音频轨道设置audio direction
                    if self.audio_track and self.audio_track.audio_track:
                        transceiver._direction = "sendonly"
                        if hasattr(transceiver, '_offerDirection'):
                            transceiver._offerDirection = "recvonly"
                        else:
                            setattr(transceiver, '_offerDirection', "recvonly")
                    else:
                        transceiver._direction = "inactive"
                        if hasattr(transceiver, '_offerDirection'):
                            transceiver._offerDirection = "inactive"
                        else:
                            setattr(transceiver, '_offerDirection', "inactive")
                    logger.info("修复audio transceiver direction")
            
            # 创建answer
            answer = await self.peer_connection.createAnswer()
            await self.peer_connection.setLocalDescription(answer)
            
            # 发送answer
            response = {
                "type": "answer",
                "sdp": answer.sdp
            }
            await self.websocket.send(json.dumps(response))
            logger.info("已发送answer")
            
            # 手动收集和发送ICE候选
            await self._collect_and_send_ice_candidates()
            
        except Exception as e:
            logger.error(f"处理offer失败: {e}")
            import traceback
            logger.error(f"详细错误信息: {traceback.format_exc()}")
            # 不要重新抛出异常，让连接保持活跃
    
    async def _collect_and_send_ice_candidates(self):
        """手动收集和发送ICE候选"""
        try:
            # 等待ICE收集完成
            while self.peer_connection.iceGatheringState != "complete":
                await asyncio.sleep(0.1)
            
            # 获取本地描述中的ICE候选
            local_desc = self.peer_connection.localDescription
            if local_desc and local_desc.sdp:
                # 解析SDP中的ICE候选
                sdp_lines = local_desc.sdp.split('\n')
                candidate_count = 0
                for line in sdp_lines:
                    if line.startswith('a=candidate:'):
                        candidate_count += 1
                        candidate_line = line[12:]  # 移除 'a=candidate:' 前缀
                        logger.info(f"🧊 发现ICE候选 #{candidate_count}: {candidate_line}")
                        
                        # 发送ICE候选
                        candidate_message = {
                            "type": "ice_candidate",
                            "candidate": {
                                "candidate": line,
                                "sdpMLineIndex": 0,
                                "sdpMid": "0"
                            }
                        }
                        await self.websocket.send(json.dumps(candidate_message))
                        logger.info(f"✅ ICE候选 #{candidate_count} 已发送")
                        
                logger.info(f"🧊 总共发送了 {candidate_count} 个ICE候选")
            else:
                logger.warning("⚠️  未找到本地描述或SDP为空")
            
        except Exception as e:
            logger.error(f"收集ICE候选失败: {e}")
    
    async def _handle_answer(self, message: Dict[str, Any]):
        """处理answer响应"""
        try:
            logger.info("📨 收到Web客户端的answer响应")
            
            answer = RTCSessionDescription(
                sdp=message["sdp"],
                type=message["type"]
            )
            
            # 设置远程描述
            await self.peer_connection.setRemoteDescription(answer)
            logger.info("✅ 已设置远程描述 (answer)")
            
        except Exception as e:
            logger.error(f"❌ 处理answer失败: {e}")
            import traceback
            logger.error(f"详细错误信息: {traceback.format_exc()}")
    
    async def _handle_ice_candidate(self, message: Dict[str, Any]):
        """处理ICE候选 - 兼容不同格式"""
        try:
            candidate_data = message.get("candidate")
            if not candidate_data:
                logger.debug("收到空的ICE候选数据，跳过")
                return
                
            logger.debug(f"🧊 收到ICE候选数据: {candidate_data}")
            
            # 处理不同的ICE候选格式
            # 格式1: 标准WebRTC格式 - {"candidate": "candidate:...", "sdpMid": "0", "sdpMLineIndex": 0}
            if isinstance(candidate_data, dict) and "candidate" in candidate_data:
                candidate_str = candidate_data["candidate"]
                sdp_mid = candidate_data.get("sdpMid", "0")
                sdp_m_line_index = candidate_data.get("sdpMLineIndex", 0)
                
                logger.debug(f"格式1处理: candidate_str={candidate_str}, sdpMid={sdp_mid}, sdpMLineIndex={sdp_m_line_index}")
                
                # 手动解析候选字符串
                try:
                    # 候选字符串格式: "candidate:1 1 UDP 2130706431 192.168.1.100 54400 typ host"
                    if not candidate_str or not isinstance(candidate_str, str):
                        logger.warning(f"候选字符串无效: {candidate_str}")
                        return
                        
                    parts = candidate_str.split()
                    if len(parts) >= 8 and parts[0].startswith("candidate:"):
                        foundation = parts[0][10:]  # 去掉"candidate:"前缀
                        component = int(parts[1])
                        protocol = parts[2].lower()
                        priority = int(parts[3])
                        ip = parts[4]
                        port = int(parts[5])
                        typ = parts[7] if len(parts) > 7 else "host"
                        
                        candidate = RTCIceCandidate(
                            foundation=foundation,
                            component=component,
                            protocol=protocol,
                            priority=priority,
                            ip=ip,
                            port=port,
                            type=typ,
                            sdpMid=sdp_mid,
                            sdpMLineIndex=sdp_m_line_index
                        )
                        
                        await self.peer_connection.addIceCandidate(candidate)
                        logger.debug(f"✅ 已添加ICE候选 (格式1): {candidate_str[:50]}...")
                        return
                    else:
                        logger.warning(f"无法解析候选字符串格式: {candidate_str}")
                        
                except Exception as parse_error:
                    logger.warning(f"解析候选字符串失败: {parse_error}")
                    # 继续尝试其他格式
            
            # 格式2: 分解字段格式 - 尝试兼容处理
            elif isinstance(candidate_data, dict):
                logger.debug(f"格式2处理: {candidate_data}")
                try:
                    # 获取字段，提供默认值
                    component = candidate_data.get("component", 1)
                    foundation = candidate_data.get("foundation", "1")
                    ip = candidate_data.get("ip") or candidate_data.get("address", "")
                    port = candidate_data.get("port", 0)
                    priority = candidate_data.get("priority", 1)
                    protocol = candidate_data.get("protocol", "udp")
                    type_val = candidate_data.get("type", "host")
                    
                    # 检查关键字段
                    if not ip or port == 0:
                        logger.debug(f"ICE候选缺少关键信息，跳过: ip={ip}, port={port}")
                        return
                    
                    # 使用message中的sdpMid和sdpMLineIndex信息
                    sdp_mid = message.get("sdpMid", "0")
                    sdp_m_line_index = message.get("sdpMLineIndex", 0)
                    
                    candidate = RTCIceCandidate(
                        foundation=str(foundation),
                        component=int(component),
                        protocol=str(protocol).lower(),
                        priority=int(priority),
                        ip=str(ip),
                        port=int(port),
                        type=str(type_val),
                        sdpMid=str(sdp_mid),
                        sdpMLineIndex=int(sdp_m_line_index)
                    )
                    
                    await self.peer_connection.addIceCandidate(candidate)
                    logger.debug(f"✅ 已添加ICE候选 (格式2): {ip}:{port} ({type_val})")
                    return
                    
                except Exception as e:
                    logger.warning(f"格式2处理失败: {e}")
            else:
                logger.warning(f"未知的ICE候选格式: {type(candidate_data)} {candidate_data}")
                
        except Exception as e:
            logger.warning(f"ICE候选处理失败: {e}")
            import traceback
            logger.debug(f"ICE处理详细错误: {traceback.format_exc()}")
    
    def _on_connection_state_change(self):
        """连接状态变化处理"""
        if not self.peer_connection:
            return
            
        state = self.peer_connection.connectionState
        logger.info(f"🔄 WebRTC连接状态变更: {state}")
        
        if state == "connected":
            logger.info("✅ WebRTC连接已建立！")
            # 取消连接超时检测
            if hasattr(self, 'connection_timeout') and self.connection_timeout:
                self.connection_timeout.cancel()
                self.connection_timeout = None
        elif state == "disconnected":
            logger.warning("⚠️  WebRTC连接已断开，准备接受新连接...")
            # 异步重置连接
            asyncio.create_task(self._reset_peer_connection())
        elif state == "failed":
            logger.error("❌ WebRTC连接失败，准备接受新连接...")
            # 异步重置连接
            asyncio.create_task(self._reset_peer_connection())
        elif state == "closed":
            logger.info("🔒 WebRTC连接已关闭")
        elif state == "connecting":
            logger.info("🔗 WebRTC正在连接...")
            # 启动连接超时检测
            if hasattr(self, 'connection_timeout') and self.connection_timeout:
                self.connection_timeout.cancel()
            if hasattr(self, 'connection_timeout_duration'):
                self.connection_timeout = asyncio.create_task(self._connection_timeout_handler())
    
    def _on_ice_gathering_state_change(self):
        """处理ICE收集状态变化"""
        if not self.peer_connection:
            return
        state = self.peer_connection.iceGatheringState
        logger.info(f"🧊 ICE收集状态: {state}")
        
        if state == "gathering":
            logger.info("🔍 正在收集ICE候选...")
        elif state == "complete":
            logger.info("✅ ICE候选收集完成")
    
    def _on_ice_connection_state_change(self):
        """处理ICE连接状态变化"""
        if not self.peer_connection:
            return
        state = self.peer_connection.iceConnectionState
        logger.info(f"❄️  ICE连接状态: {state}")
        
        if state == "checking":
            logger.info("🔍 正在检查ICE连接...")
        elif state == "connected":
            logger.info("✅ ICE连接已建立")
        elif state == "completed":
            logger.info("🎉 ICE连接完成")
        elif state == "failed":
            logger.error("❌ ICE连接失败")
        elif state == "disconnected":
            logger.warning("⚠️  ICE连接断开")
        elif state == "closed":
            logger.info("🔒 ICE连接已关闭")
    
    async def _connection_timeout_handler(self):
        """连接超时处理"""
        try:
            await asyncio.sleep(self.connection_timeout_duration)
            if self.peer_connection and self.peer_connection.connectionState == "connecting":
                logger.error(f"⏰ WebRTC连接超时 ({self.connection_timeout_duration}秒)，尝试重置连接")
                await self._reset_peer_connection()
        except asyncio.CancelledError:
            # 正常取消，连接成功
            pass
        except Exception as e:
            logger.error(f"连接超时处理器错误: {e}")
    
    async def _on_ice_candidate(self, candidate):
        """ICE候选生成处理"""
        if candidate:
            # 打印详细的ICE候选信息
            logger.info(f"🧊 生成ICE候选: {candidate.type}")
            logger.info(f"   协议: {candidate.protocol}")
            logger.info(f"   地址: {candidate.ip}:{candidate.port}")
            logger.info(f"   优先级: {candidate.priority}")
            
            # 修复ICE候选格式，与Web客户端兼容
            message = {
                "type": "ice_candidate",
                "candidate": {
                    "candidate": f"candidate:{candidate.foundation} {candidate.component} {candidate.protocol} {candidate.priority} {candidate.ip} {candidate.port} typ {candidate.type}",
                    "sdpMLineIndex": 0,  # 通常视频是第一个m-line
                    "sdpMid": "0"        # 对应第一个媒体段
                }
            }
            await self.websocket.send(json.dumps(message))
            logger.info("✅ ICE候选已发送")
        else:
            logger.info("🧊 ICE候选收集完成 (null candidate)")
    
    async def _keep_alive(self):
        """保持连接活跃，并添加心跳机制"""
        # 启动心跳任务
        heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        
        try:
            async for message in self.websocket:
                data = json.loads(message)
                await self._handle_signaling_message(data)
        except websockets.exceptions.ConnectionClosed as e:
            logger.warning(f"WebSocket连接已关闭: {e}")
            raise  # 重新抛出异常以触发重连
        except websockets.exceptions.ConnectionClosedError as e:
            logger.warning(f"WebSocket连接错误关闭: {e}")
            raise  # 重新抛出异常以触发重连
        except json.JSONDecodeError as e:
            logger.error(f"JSON解析错误: {e}")
            # JSON错误不应触发重连，继续运行
        except Exception as e:
            logger.error(f"保持连接时发生错误: {e}")
            raise  # 重新抛出异常以触发重连
        finally:
            # 取消心跳任务
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
    
    async def _heartbeat_loop(self):
        """发送心跳保持连接"""
        while True:
            try:
                await asyncio.sleep(30)  # 每30秒发送一次心跳
                if self.websocket and not self.websocket.closed and self.client_id:
                    heartbeat_msg = {
                        'type': 'heartbeat',
                        'clientId': self.client_id,
                        'roomId': self.room_id,
                        'timestamp': int(time.time())
                    }
                    await self.websocket.send(json.dumps(heartbeat_msg))
                    logger.debug("💓 心跳已发送")
            except asyncio.CancelledError:
                logger.debug("心跳任务已取消")
                break
            except Exception as e:
                logger.debug(f"心跳发送失败: {e}")
                break
    
    async def cleanup(self):
        """清理资源"""
        logger.info("开始清理资源...")
        
        if self.video_track:
            self.video_track.cleanup()
        
        if self.peer_connection:
            await self.peer_connection.close()
        
        if self.websocket:
            await self.websocket.close()
        
        logger.info("资源清理完成")
    
    def stop_reconnection(self):
        """停止重连机制"""
        self.reconnect_enabled = False
        logger.info("重连机制已禁用")


async def main():
    """主函数"""
    import argparse
    
    parser = argparse.ArgumentParser(description="机器人WebRTC视频流客户端")
    parser.add_argument("--server", default="ws://123.56.125.236:3001", help="信令服务器URL")
    parser.add_argument("--robot-id", default=None, help="机器人ID")
    parser.add_argument("--camera", type=int, default=0, help="摄像头设备ID")
    parser.add_argument("--no-audio", action="store_true", help="禁用音频")
    parser.add_argument("--no-reconnect", action="store_true", help="禁用自动重连")
    parser.add_argument("--max-reconnect", type=int, default=10, help="最大重连次数")
    parser.add_argument("--reconnect-delay", type=int, default=5, help="重连延迟秒数")
    
    args = parser.parse_args()
    
    client = RobotWebRTCClient(
        signaling_server_url=args.server,
        robot_id=args.robot_id,
        camera_device=args.camera,
        enable_audio=not args.no_audio
    )
    
    # 进行网络测试
    await client._test_network_connectivity()
    
    # 配置重连参数
    if args.no_reconnect:
        client.reconnect_enabled = False
    client.max_reconnect_attempts = args.max_reconnect
    client.reconnect_delay = args.reconnect_delay
    
    try:
        await client.start()
    except KeyboardInterrupt:
        logger.info("收到中断信号，正在关闭...")
        client.stop_reconnection()  # 停止重连机制
    except Exception as e:
        logger.error(f"运行时错误: {e}")
        client.stop_reconnection()  # 停止重连机制
    finally:
        await client.cleanup()


if __name__ == "__main__":
    # 在NVIDIA ORIN NX上可以使用uvloop提升性能
    try:
        import uvloop
        uvloop.install()
        logger.info("使用uvloop事件循环")
    except ImportError:
        logger.info("使用默认事件循环")
    
    asyncio.run(main())
