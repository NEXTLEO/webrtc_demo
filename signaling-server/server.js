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

wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  console.log(`New connection: ${clientId}`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleMessage(ws, clientId, data);
    } catch (error) {
      console.error('Invalid JSON:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Invalid JSON format' 
      }));
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected: ${clientId}`);
    clients.delete(clientId);
    
    // 从房间中移除客户端
    for (const [roomId, room] of rooms.entries()) {
      if (room.robot === clientId || room.web === clientId) {
        rooms.delete(roomId);
        // 通知另一个客户端连接已断开
        const otherClientId = room.robot === clientId ? room.web : room.robot;
        const otherClient = clients.get(otherClientId);
        if (otherClient) {
          otherClient.send(JSON.stringify({
            type: 'peer_disconnected'
          }));
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
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Client not registered'
    }));
    return;
  }

  let room = rooms.get(roomId) || { robot: null, web: null };

  if (client.type === CLIENT_TYPES.ROBOT) {
    if (room.robot) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Room already has a robot'
      }));
      return;
    }
    room.robot = clientId;
  } else {
    if (room.web) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Room already has a web client'
      }));
      return;
    }
    room.web = clientId;
  }

  rooms.set(roomId, room);

  ws.send(JSON.stringify({
    type: 'room_joined',
    roomId,
    role: client.type
  }));

  // 如果房间里有两个客户端，通知他们可以开始连接
  if (room.robot && room.web) {
    const robotClient = clients.get(room.robot);
    const webClient = clients.get(room.web);
    
    if (robotClient && webClient) {
      robotClient.ws.send(JSON.stringify({
        type: 'peer_joined',
        peerId: room.web,
        peerType: CLIENT_TYPES.WEB
      }));
      
      webClient.ws.send(JSON.stringify({
        type: 'peer_joined',
        peerId: room.robot,
        peerType: CLIENT_TYPES.ROBOT
      }));
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
    if (room.robot && !room.web) {
      const robotClient = clients.get(room.robot);
      availableRooms.push({
        roomId,
        robotId: robotClient && robotClient.robotId ? robotClient.robotId : room.robot,
        robotConnectedAt: robotClient && robotClient.joinedAt ? robotClient.joinedAt : undefined
      });
    }
  }

  ws.send(JSON.stringify({
    type: 'available_rooms',
    rooms: availableRooms
  }));
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
    if (room.robot && !room.web) {
      const robotClient = clients.get(room.robot);
      availableRobots.push({
        roomId,
        robotId: robotClient && robotClient.robotId ? robotClient.robotId : room.robot,
        robotConnectedAt: robotClient && robotClient.joinedAt ? robotClient.joinedAt : undefined,
        status: 'available'
      });
    }
  }

  res.json({
    robots: availableRobots,
    total: availableRobots.length
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

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`=== WebRTC集成服务器启动成功 ===`);
  console.log(`服务器端口: ${PORT}`);
  console.log(`Web客户端: http://localhost:${PORT}`);
  console.log(`WebSocket端点: ws://localhost:${PORT}`);
  console.log(`API健康检查: http://localhost:${PORT}/api/health`);
  console.log(`API统计信息: http://localhost:${PORT}/api/stats`);
  console.log(`可用机器人: http://localhost:${PORT}/api/robots`);
  console.log(`===================================`);
});
