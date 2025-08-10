const fs = require('fs-extra');
const path = require('path');

console.log('=== 构建Web客户端到服务端 ===');

const webClientSrc = path.join(__dirname, '..', 'web-client');
const publicDest = path.join(__dirname, 'public');

async function buildWebClient() {
  try {
    // 确保目标目录存在
    await fs.ensureDir(publicDest);
    
    // 复制HTML文件
    console.log('复制 index.html...');
    await fs.copy(path.join(webClientSrc, 'index.html'), path.join(publicDest, 'index.html'));
    
    // 复制CSS文件
    console.log('复制 styles.css...');
    await fs.copy(path.join(webClientSrc, 'styles.css'), path.join(publicDest, 'styles.css'));
    
    // 复制并修改JS文件
    console.log('复制并配置 webrtc-client.js...');
    let jsContent = await fs.readFile(path.join(webClientSrc, 'webrtc-client.js'), 'utf8');
    
    // 修改默认服务器URL为当前主机
    jsContent = jsContent.replace(
      'signaling_server_url: str = "ws://localhost:3001"',
      `// 自动检测服务器地址
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        signaling_server_url: str = \`\${protocol}//\${host}\``
    );
    
    // 修改默认服务器URL配置
    jsContent = jsContent.replace(
      'value="ws://localhost:3001"',
      'value="" id="server-url-auto"'
    );
    
    await fs.writeFile(path.join(publicDest, 'webrtc-client.js'), jsContent);
    
    // 创建更新的HTML文件，自动配置服务器地址
    console.log('更新HTML配置...');
    let htmlContent = await fs.readFile(path.join(publicDest, 'index.html'), 'utf8');
    
    // 添加自动配置服务器地址的脚本
    const autoConfigScript = `
    <script>
        // 自动配置服务器地址
        document.addEventListener('DOMContentLoaded', function() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host;
            const serverUrl = protocol + '//' + host;
            
            const serverUrlInput = document.getElementById('server-url');
            if (serverUrlInput && !serverUrlInput.value) {
                serverUrlInput.value = serverUrl;
            }
        });
    </script>`;
    
    htmlContent = htmlContent.replace('</head>', autoConfigScript + '\n</head>');
    
    await fs.writeFile(path.join(publicDest, 'index.html'), htmlContent);
    
    // 创建favicon和其他静态资源
    console.log('创建favicon...');
    const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="45" fill="#2196F3"/>
      <text x="50" y="55" text-anchor="middle" fill="white" font-size="40">🤖</text>
    </svg>`;
    await fs.writeFile(path.join(publicDest, 'favicon.svg'), faviconSvg);
    
    // 创建manifest.json
    console.log('创建应用清单...');
    const manifest = {
      name: "机器人远程监控",
      short_name: "机器人监控",
      description: "WebRTC机器人远程音视频监控系统",
      start_url: "/",
      display: "standalone",
      background_color: "#f5f5f5",
      theme_color: "#2196F3",
      icons: [
        {
          src: "favicon.svg",
          sizes: "any",
          type: "image/svg+xml"
        }
      ]
    };
    await fs.writeFile(path.join(publicDest, 'manifest.json'), JSON.stringify(manifest, null, 2));
    
    // 更新HTML以包含manifest和favicon
    htmlContent = await fs.readFile(path.join(publicDest, 'index.html'), 'utf8');
    const headAdditions = `
    <link rel="icon" type="image/svg+xml" href="favicon.svg">
    <link rel="manifest" href="manifest.json">
    <meta name="theme-color" content="#2196F3">`;
    
    htmlContent = htmlContent.replace('</head>', headAdditions + '\n</head>');
    await fs.writeFile(path.join(publicDest, 'index.html'), htmlContent);
    
    console.log('=== 构建完成 ===');
    console.log(`Web客户端已部署到: ${publicDest}`);
    console.log('现在可以通过浏览器直接访问服务器来使用Web客户端');
    
  } catch (error) {
    console.error('构建失败:', error);
    process.exit(1);
  }
}

// 检查源目录是否存在
if (!fs.existsSync(webClientSrc)) {
  console.error(`错误: Web客户端源目录不存在: ${webClientSrc}`);
  process.exit(1);
}

buildWebClient();
