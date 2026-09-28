const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

module.exports = {
  // 全局 HTTP 请求配置（搜索、详情、测速、下载共用）
  http: {
    // 是否跳过 SSL 证书验证
    skipSslVerification: false,
    // 请求超时时间（毫秒）——全项目所有网络请求（搜索/详情/下载/通知/测速）统一的响应超时
    timeout: 5000,
    // 公共请求头
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
      Accept:
        'application/json, text/html, application/xhtml+xml, application/xml;q=0.9, image/avif, image/webp, image/apng, */*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
    },
  },

  // 日志配置
  log: {
    // 是否记录详细日志到文件
    toFile: true,
  },

  // 代理地址（前缀拼接型，请求时拼为 {proxyUrl}/{原始URL}）
  // 优先读取 .env 中的 PROXY_URL；未配置时为空，表示直连。
  // 示例值：https://proxy.example.com
  // proxyMode：'proxy' 走代理 | 'direct' 直连 | 'fallback' 先直连（重试），失败回退代理
  proxyUrl: process.env.PROXY_URL || '',

  // 下载 LunaTV-config.json
  download: {
    proxyMode: 'fallback',
  },

  // 搜索检测配置
  // concurrent: 仅搜索模式时的并发数（playSpeedTest.enable=false 时生效）
  // maxRetry: 搜索失败最大重试次数，因为多关键词相当于重试，这会让每个关键词的重试次数增加，不建议超过 2 次
  // retryDelay: 重试间隔（毫秒）
  // keywords: 普通视频搜索关键词列表，按顺序依次尝试
  // adultKeywords: 成人视频搜索关键词列表，按顺序依次尝试
  search: {
    proxyMode: 'fallback',
    concurrent: 20,
    maxRetry: 1,
    retryDelay: 1000,
    keywords: ['哈哈哈哈', '斗破苍穹', '甄嬛传'],
    adultKeywords: ['三上悠亚', '家庭教师', '丝袜'],
  },

  // 播放测速配置
  // enable: 是否启用播放测速（false 时仅做搜索检测）
  // duration: 每次测速持续时间（毫秒）
  // concurrent: 搜索+测速模式下的总并发数（enable=true 时覆盖 search.concurrent）
  playSpeedTest: {
    proxyMode: 'fallback',
    enable: true,
    duration: 5000,
    concurrent: 6,
  },

  // 通知配置（脚本 05_notify.js）
  // enable: 是否启用通知
  // botToken: 环境变量 TG_BOT_TOKEN（Telegram Bot Token）
  // chatId: 环境变量 TG_CHAT_ID（接收通知的聊天 ID）
  // 注意: enable 为 true 且 botToken/chatId 都有值时才会发送通知；
  // 发送失败不阻塞数据更新流程
  telegram: {
    proxyMode: 'fallback',
    enable: true,
    botToken: process.env.TG_BOT_TOKEN || '',
    chatId: process.env.TG_CHAT_ID || '',
  },
};
