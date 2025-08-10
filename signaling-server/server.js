const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// 安全发送消息的辅助函数
function safeSend(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error(`Error sending message: ${error.message}`);
      return false;
    }
  }
  return false;
}

// 静态文件服务 - 提供Web客户端
const webClientPath = path.join(__dirname, 'public');
app.use(express.static(webClientPath));

// 确保public目录存在
if (!fs.existsSync(webClientPath)) {
  fs.mkdirSync(webClientPath, { recursive: true });
  console.log('Created public directory for web client');
}

// 存储连接的客户端
const clients = new Map();
const rooms = new Map();

// 客户端类型
const CLIENT_TYPES = {
  ROBOT: 'robot',
  WEB: 'web'
};

// 心跳间隔 (30秒)
const HEARTBEAT_INTERVAL = 30000;

wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  console.log(`New connection: ${clientId}`);
  
  // 初始化客户端信息
  const clientInfo = {
    ws: ws,
    id: clientId,
    type: null,
    robotId: null,
    joinedAt: new Date(),
    lastPing: Date.now(),
    isAlive: true
  };
  
  // 设置心跳检测
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
    clientInfo.lastPing = Date.now();
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // 处理心跳消息
      if (data.type === 'ping') {
        safeSend(ws, { type: 'pong', timestamp: Date.now() });
        clientInfo.lastPing = Date.now();
        return;
      }
      
      handleMessage(ws, clientId, data);
    } catch (error) {
      console.error('Invalid JSON:', error);
      safeSend(ws, { 
        type: 'error', 
        message: 'Invalid JSON format' 
      });
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected: ${clientId}`);
    const client = clients.get(clientId);
    clients.delete(clientId);
    
    // 从房间中移除客户端
    for (const [roomId, room] of rooms.entries()) {
      if (room.robot === clientId || room.web === clientId) {
        // 通知另一个客户端连接已断开
        const otherClientId = room.robot === clientId ? room.web : room.robot;
        const otherClient = clients.get(otherClientId);
        if (otherClient) {
          safeSend(otherClient.ws, {
            type: 'peer_disconnected'
          });
        }
        
        // 根据断开的客户端类型决定房间处理策略
        if (client && client.type === CLIENT_TYPES.ROBOT) {
          // 机器人断开时，设置延迟删除（给重连机会）
          room.robot = null;
          room.robotDisconnectedAt = Date.now();
          console.log(`Robot disconnected, room ${roomId} marked for cleanup in 60 seconds`);
          
          // 通知Web客户端机器人已断开
          if (otherClient) {
            safeSend(otherClient.ws, {
              type: 'robot_disconnected',
              roomId: roomId,
              message: '机器人已断开连接，等待重连...'
            });
          }
          
          // 60秒后清理房间（如果机器人没有重连）
          setTimeout(() => {
            const currentRoom = rooms.get(roomId);
            if (currentRoom && !currentRoom.robot && currentRoom.robotDisconnectedAt === room.robotDisconnectedAt) {
              rooms.delete(roomId);
              console.log(`Room ${roomId} cleaned up after robot timeout`);
              
              // 通知Web客户端房间已被清理
              if (currentRoom.web) {
                const webClient = clients.get(currentRoom.web);
                if (webClient) {
                  safeSend(webClient.ws, {
                    type: 'room_closed',
                    roomId: roomId,
                    message: '机器人超时未重连，房间已关闭'
                  });
                }
              }
            }
          }, 60000); // 60秒超时
          
        } else if (client && client.type === CLIENT_TYPES.WEB) {
          // Web客户端断开时保留房间，只清空web字段
          room.web = null;
          console.log(`Web client disconnected, room ${roomId} kept for robot reconnection`);
        } else {
          // 未知类型，删除房间
          rooms.delete(roomId);
        }
        break;
      }
    }
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for ${clientId}:`, error);
  });
});

function handleMessage(ws, clientId, data) {
  console.log(`Message from ${clientId}:`, data.type);

  switch (data.type) {
    case 'register':
      registerClient(ws, clientId, data);
      break;
    case 'join_room':
      joinRoom(ws, clientId, data);
      break;
    case 'offer':
    case 'answer':
    case 'ice_candidate':
      relaySignalingMessage(clientId, data);
      break;
    case 'get_rooms':
      sendAvailableRooms(ws);
      break;
    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${data.type}`
      }));
  }
}

function registerClient(ws, clientId, data) {
  const { clientType, robotId } = data;
  
  if (!Object.values(CLIENT_TYPES).includes(clientType)) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Invalid client type'
    }));
    return;
  }

  clients.set(clientId, {
    ws,
    type: clientType,
    robotId: clientType === CLIENT_TYPES.ROBOT ? (robotId || clientId) : null,
    joinedAt: new Date()
  });

  ws.send(JSON.stringify({
    type: 'registered',
    clientId,
    clientType
  }));

  console.log(`Client registered: ${clientId} as ${clientType}`);
}

function joinRoom(ws, clientId, data) {
  const { roomId } = data;
  const client = clients.get(clientId);
  
  if (!client) {
    safeSend(ws, {
      type: 'error',
      message: 'Client not registered'
    });
    return;
  }

  let room = rooms.get(roomId);
  
  // 如果房间不存在，创建新房间
  if (!room) {
    room = { robot: null, web: null };
    rooms.set(roomId, room);
  }
  
  // 清理过期的机器人断线标记
  if (room.robotDisconnectedAt && client.type === CLIENT_TYPES.ROBOT) {
    delete room.robotDisconnectedAt;
    console.log(`Robot reconnected to room ${roomId}, cleared disconnect marker`);
  }

  if (client.type === CLIENT_TYPES.ROBOT) {
    if (room.robot && room.robot !== clientId) {
      safeSend(ws, {
        type: 'error',
        message: 'Room already has a robot'
      });
      return;
    }
    room.robot = clientId;
    
    // 如果有Web客户端在等待，通知它机器人已重连
    if (room.web) {
      const webClient = clients.get(room.web);
      if (webClient) {
        safeSend(webClient.ws, {
          type: 'robot_reconnected',
          roomId: roomId,
          robotId: client.robotId,
          message: '机器人已重连'
        });
      }
    }
    
  } else {
    // Web客户端加入房间
    if (room.web && room.web !== clientId) {
      safeSend(ws, {
        type: 'error',
        message: 'Room already has a web client'
      });
      return;
    }
    
    // 检查房间状态
    if (!room.robot && room.robotDisconnectedAt) {
      // 机器人已断线，但还在等待重连期内
      safeSend(ws, {
        type: 'room_status',
        roomId: roomId,
        status: 'waiting_robot',
        message: '机器人暂时断线，等待重连中...'
      });
    } else if (!room.robot) {
      // 房间没有机器人
      safeSend(ws, {
        type: 'room_status',
        roomId: roomId,
        status: 'no_robot',
        message: '房间中没有机器人，请选择其他房间'
      });
      return;
    }
    
    room.web = clientId;
  }

  rooms.set(roomId, room);

  safeSend(ws, {
    type: 'room_joined',
    roomId,
    role: client.type,
    roomStatus: {
      hasRobot: !!room.robot,
      hasWeb: !!room.web,
      robotDisconnected: !!room.robotDisconnectedAt
    }
  });

  // 如果房间里有两个客户端，通知他们可以开始连接
  if (room.robot && room.web) {
    const robotClient = clients.get(room.robot);
    const webClient = clients.get(room.web);
    
    if (robotClient && webClient) {
      safeSend(robotClient.ws, {
        type: 'peer_joined',
        peerId: room.web,
        peerType: CLIENT_TYPES.WEB
      });
      
      safeSend(webClient.ws, {
        type: 'peer_joined',
        peerId: room.robot,
        peerType: CLIENT_TYPES.ROBOT,
        robotId: robotClient.robotId
      });
    }
  }

  console.log(`Client ${clientId} joined room ${roomId}`);
}

function relaySignalingMessage(senderId, data) {
  // 找到发送者所在的房间
  let targetClientId = null;
  
  for (const [roomId, room] of rooms.entries()) {
    if (room.robot === senderId) {
      targetClientId = room.web;
      break;
    } else if (room.web === senderId) {
      targetClientId = room.robot;
      break;
    }
  }

  if (!targetClientId) {
    console.error(`No peer found for sender ${senderId}`);
    return;
  }

  const targetClient = clients.get(targetClientId);
  if (targetClient) {
    // 添加发送者信息
    const messageWithSender = {
      ...data,
      from: senderId
    };
    
    targetClient.ws.send(JSON.stringify(messageWithSender));
    console.log(`Relayed ${data.type} from ${senderId} to ${targetClientId}`);
  } else {
    console.error(`Target client ${targetClientId} not found`);
  }
}

function sendAvailableRooms(ws) {
  const availableRooms = [];
  
  for (const [roomId, room] of rooms.entries()) {
    // 只显示有机器人且机器人在线的房间
    if (room.robot && !room.robotDisconnectedAt && !room.web) {
      const robotClient = clients.get(room.robot);
      if (robotClient) { // 确保机器人客户端仍然存在
        availableRooms.push({
          roomId,
          robotId: robotClient.robotId || room.robot,
          robotConnectedAt: robotClient.joinedAt,
          status: 'available'
        });
      }
    } else if (room.robot && room.robotDisconnectedAt && !room.web) {
      // 机器人断线但还在重连期内的房间
      availableRooms.push({
        roomId,
        robotId: 'disconnected',
        robotConnectedAt: null,
        status: 'robot_disconnected',
        message: '机器人暂时断线，等待重连中...'
      });
    }
  }

  safeSend(ws, {
    type: 'available_rooms',
    rooms: availableRooms,
    timestamp: Date.now()
  });
}

// Web客户端路由
app.get('/', (req, res) => {
  res.sendFile(path.join(webClientPath, 'index.html'));
});

// API路由
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    clients: clients.size,
    rooms: rooms.size,
    timestamp: new Date().toISOString(),
    server: 'WebRTC Integrated Server',
    version: '1.0.0'
  });
});

// 获取统计信息
app.get('/api/stats', (req, res) => {
  const stats = {
    totalClients: clients.size,
    totalRooms: rooms.size,
    robotClients: Array.from(clients.values()).filter(c => c.type === CLIENT_TYPES.ROBOT).length,
    webClients: Array.from(clients.values()).filter(c => c.type === CLIENT_TYPES.WEB).length,
    activeRooms: Array.from(rooms.values()).filter(r => r.robot && r.web).length,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  };
  
  res.json(stats);
});

// 获取可用机器人列表的API端点
app.get('/api/robots', (req, res) => {
  const availableRobots = [];
  
  for (const [roomId, room] of rooms.entries()) {
    if (room.robot && !room.robotDisconnectedAt && !room.web) {
      const robotClient = clients.get(room.robot);
      if (robotClient) {
        availableRobots.push({
          roomId,
          robotId: robotClient.robotId || room.robot,
          robotConnectedAt: robotClient.joinedAt,
          status: 'available'
        });
      }
    } else if (room.robot && room.robotDisconnectedAt) {
      const disconnectedTime = Date.now() - room.robotDisconnectedAt;
      availableRobots.push({
        roomId,
        robotId: 'disconnected',
        robotConnectedAt: null,
        status: 'disconnected',
        disconnectedFor: disconnectedTime,
        message: `机器人断线 ${Math.floor(disconnectedTime/1000)} 秒，等待重连中...`
      });
    }
  }

  res.json({
    robots: availableRobots,
    total: availableRobots.length,
    available: availableRobots.filter(r => r.status === 'available').length,
    disconnected: availableRobots.filter(r => r.status === 'disconnected').length
  });
});

// 健康检查端点 (保持向后兼容)
app.get('/health', (req, res) => {
  res.redirect('/api/health');
});

// 获取统计信息 (保持向后兼容)
app.get('/stats', (req, res) => {
  res.redirect('/api/stats');
});

// 全局错误处理
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // 不退出进程，继续运行
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // 不退出进程，继续运行
});

// 心跳检测定时器
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('Client connection timeout, terminating...');
      return ws.terminate();
    }
    
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const EXTERNAL_IP = process.env.EXTERNAL_IP || '123.56.125.236';
server.listen(PORT, HOST, () => {
  console.log(`=== WebRTC集成服务器启动成功 ===`);
  console.log(`服务器端口: ${PORT}`);
  console.log(`绑定地址: ${HOST}`);
  console.log(`Web客户端: http://localhost:${PORT}`);
  console.log(`外部访问: http://${EXTERNAL_IP}:${PORT}`);
  console.log(`WebSocket端点: ws://${EXTERNAL_IP}:${PORT}`);
  console.log(`API健康检查: http://${EXTERNAL_IP}:${PORT}/api/health`);
  console.log(`API统计信息: http://${EXTERNAL_IP}:${PORT}/api/stats`);
  console.log(`可用机器人: http://${EXTERNAL_IP}:${PORT}/api/robots`);
  console.log(`===================================`);
});
