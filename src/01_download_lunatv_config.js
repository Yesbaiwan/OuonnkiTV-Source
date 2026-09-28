const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');
const config = require('./config.js');
const { applyProxy, tryWithProxy } = require('./proxy.js');

const url =
  'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/LunaTV-config.json';
const targetDir = path.join(__dirname, '..', 'tv_source', 'LunaTV');
const filepath = path.join(targetDir, 'LunaTV-config.json');

const requestConfig = {
  responseType: 'text',
  timeout: config.http.timeout,
  headers: config.http.headers,
  httpsAgent: new https.Agent({ rejectUnauthorized: !config.http.skipSslVerification }),
};

(async () => {
  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    console.log('正在下载: LunaTV-config.json');

    // 按 download.proxyMode 依次尝试（'fallback' = 直连失败回退代理；代理未配置则只直连）
    const { result: response, usedProxy } = await tryWithProxy(
      config.download.proxyMode,
      (useProxy) => axios.get(applyProxy(url, useProxy), requestConfig),
    );

    fs.writeFileSync(filepath, response.data, 'utf8');
    console.log(usedProxy ? '✓ 代理下载成功' : '✓ 直接下载成功');
    console.log('✓ 已保存: LunaTV-config.json');
  } catch (error) {
    console.error(`错误: ${error.message}`);
    process.exit(1);
  }
})();
