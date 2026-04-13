const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config.js');

const url = 'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/LunaTV-config.json';
const targetDir = path.join(__dirname, '..', 'tv_source', 'LunaTV');
const filepath = path.join(targetDir, 'LunaTV-config.json');

const useProxy = config.proxy.url && config.proxy.download;

(async () => {
  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    console.log('正在下载: LunaTV-config.json');

    let response;
    try {
      response = await axios.get(url, { responseType: 'text' });
      console.log('✓ 直接下载成功');
    } catch (error) {
      if (!useProxy) {
        throw error;
      }
      console.log('直接下载失败，尝试使用代理...');
      const proxiedUrl = `${config.proxy.url}/${url}`;
      response = await axios.get(proxiedUrl, { responseType: 'text' });
      console.log('✓ 代理下载成功');
    }

    fs.writeFileSync(filepath, response.data, 'utf8');
    console.log('✓ 已保存: LunaTV-config.json');
  } catch (error) {
    console.error(`错误: ${error.message}`);
    process.exit(1);
  }
})();
