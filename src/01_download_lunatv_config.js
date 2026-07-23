const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');
const config = require('./config.js');

const url = 'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/LunaTV-config.json';
const targetDir = path.join(__dirname, '..', 'tv_source', 'LunaTV');
const filepath = path.join(targetDir, 'LunaTV-config.json');

const useProxy = config.proxy.url && config.proxy.download;

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

    const blockedHosts = /^(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/;
    const validateUrl = (urlStr) => {
      const parsed = new URL(urlStr);
      if (parsed.protocol !== 'https:') throw new Error(`Blocked non-HTTPS URL: ${urlStr}`);
      if (blockedHosts.test(parsed.hostname)) throw new Error(`Blocked internal URL: ${urlStr}`);
    };

    let response;
    if (useProxy) {
      const proxiedUrl = `${config.proxy.url}/${url}`;
      validateUrl(proxiedUrl);
      response = await axios.get(proxiedUrl, requestConfig);
      console.log('✓ 代理下载成功');
    } else {
      response = await axios.get(url, requestConfig);
      console.log('✓ 直接下载成功');
    }

    fs.writeFileSync(filepath, response.data, 'utf8');
    console.log('✓ 已保存: LunaTV-config.json');
  } catch (error) {
    console.error(`错误: ${error.message}`);
    process.exit(1);
  }
})();
