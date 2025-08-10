# 集成服务器部署指南

## 概述

现在整个系统已经简化为集成服务器模式，用户无需安装任何本地客户端，只需通过浏览器访问即可。

## 新架构

```
机器人端 (NVIDIA ORIN NX)    ←→    集成服务器    ←→    用户浏览器
    ↓                              ↓                ↓
Python + aiortc              Node.js服务器      直接访问网页
```

## 部署方式

### 1. 独立服务器部署 (推荐)

适用场景：有专门的服务器运行监控系统

```bash
# Windows
start-integrated.bat

# Linux/Mac  
chmod +x start-integrated.sh
./start-integrated.sh
```

访问：`http://服务器IP:3001`

### 2. 机器人端部署

适用场景：直接在机器人上运行服务器

```bash
cd robot-webrtc
chmod +x setup_integrated_server.sh
./setup_integrated_server.sh

# 启动集成服务器
cd ../integrated-server
npm start

# 启动机器人客户端
cd ../robot-webrtc
python robot_client.py --server ws://localhost:3001
```

访问：`http://机器人IP:3001`

### 3. Docker部署

```bash
docker-compose up -d
```

访问：`http://服务器IP:3001`

## 用户使用流程

1. **管理员操作**:
   - 启动集成服务器
   - 启动机器人客户端
   - 确保网络连通

2. **用户操作**:
   - 打开浏览器
   - 访问服务器地址
   - 点击"连接服务器"
   - 选择机器人
   - 观看实时视频

## 网络配置

### 局域网部署
- 用户访问：`http://192.168.1.100:3001`
- 机器人连接：`ws://192.168.1.100:3001`

### 公网部署
- 配置域名和SSL证书
- 用户访问：`https://your-domain.com:3001`
- 机器人连接：`wss://your-domain.com:3001`

## 优势

### 对用户的优势
- ✅ 无需安装任何软件
- ✅ 任何设备的浏览器都可以访问
- ✅ 支持手机、平板、电脑
- ✅ 即开即用

### 对部署的优势
- ✅ 只需维护一个服务器
- ✅ 统一的更新和管理
- ✅ 减少客户端兼容性问题
- ✅ 降低技术支持成本

## 安全考虑

### 生产环境建议
1. 启用HTTPS (SSL证书)
2. 配置访问控制 (IP白名单/密码认证)
3. 使用防火墙限制端口访问
4. 定期更新依赖包

### 配置示例

```javascript
// 在server.js中添加基础认证
app.use('/api', (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !checkAuth(auth)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```

## 故障排除

### 常见问题

1. **无法访问Web界面**
   - 检查服务器是否启动
   - 确认端口3001未被占用
   - 检查防火墙设置

2. **视频无法显示**
   - 确认机器人客户端已连接
   - 检查WebRTC连接状态
   - 查看浏览器控制台错误

3. **外网访问问题**
   - 配置端口转发
   - 检查公网IP和域名解析
   - 确认SSL证书配置

### 调试命令

```bash
# 检查端口占用
netstat -an | grep 3001

# 查看服务器日志
cd signaling-server
npm start

# 测试WebSocket连接
curl -I http://localhost:3001/api/health
```

## 技术支持

- 查看服务器状态：`http://服务器IP:3001/api/health`
- 查看连接统计：`http://服务器IP:3001/api/stats`
- 查看可用机器人：`http://服务器IP:3001/api/robots`
