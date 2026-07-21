const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

module.exports = {
  // 全局 HTTP 请求配置（搜索、详情、测速、下载共用）
  http: {
    // 是否跳过 SSL 证书验证
    skipSslVerification: false,
    // 请求超时时间（毫秒）
    timeout: 5000,
    // 公共请求头
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
      'Accept':
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

  // 代理配置
  //
  // url: 代理服务器地址
  //   优先级: 环境变量 PROXY_URL > 此处的默认值 ''
  //   若 .env 文件存在且设置了 PROXY_URL，则优先使用环境变量
  //   若两个都没设置（url = ''），则不启用代理
  //   示例: https://proxy.example.com
  //
  // download: 下载 LunaTV-config.json（脚本 01）
  //   true  → 走代理下载
  //   false → 直连下载
  //
  // search: 源可用性检测（脚本 03 搜索/详情阶段）
  //   true  → 始终走代理
  //   false → 直连
  //
  // play: 播放测速（脚本 03 M3U8/分段/测速阶段）
  //   true  → 始终走代理
  //   false → 先直连（含1次重试），失败后自动回退代理
  //   * 注意: false 也会回退代理。要完全禁用，需保证 proxy.url 为空（含环境变量）
  //
  // 注意: 以上三个选项仅当 proxy.url 有值时才生效。url 为空时全部直连。
  proxy: {
    url: process.env.PROXY_URL || '',
    download: true,
    search: true,
    play: false,
  },

  // 搜索检测配置
  // concurrent: 仅搜索模式时的并发数（playSpeedTest.enable=false 时生效）
  // maxRetry: 搜索失败最大重试次数，因为多关键词相当于重试，这会让每个关键词的重试次数增加，不建议超过 2 次
  // retryDelay: 重试间隔（毫秒）
  // keywords: 普通视频搜索关键词列表，按顺序依次尝试
  // adultKeywords: 成人视频搜索关键词列表，按顺序依次尝试
  search: {
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
    enable: true,
    duration: 5000,
    concurrent: 6,
  },
};
