require('dotenv').config();

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
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      'Accept':
        'application/json, text/html, application/xhtml+xml, application/xml;q=0.9, image/avif, image/webp, image/apng, */*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  },

  // 日志配置
  log: {
    // 是否记录详细日志到文件
    toFile: true,
  },

  // 代理配置
  // url: 代理服务器地址，留空不启用
  // download: 下载时是否使用代理
  // search: 搜索检测/详情请求时是否使用代理
  // play: 播放测速时是否使用代理
  proxy: {
    url: process.env.PROXY_URL || '',
    download: true,
    search: true,
    play: false,
  },

  // 搜索检测配置
  // concurrent: 仅搜索模式时的并发数（playSpeedTest.enable=false 时生效）
  // maxRetry: 搜索失败最大重试次数
  // retryDelay: 重试间隔（毫秒）
  // keyword: 普通视频搜索关键词
  // adultKeyword: 成人视频搜索关键词，留空则使用 keyword
  search: {
    concurrent: 20,
    maxRetry: 2,
    retryDelay: 1000,
    keyword: '斗罗大陆',
    adultKeyword: '三上悠',
  },

  // 播放测速配置
  // enable: 是否启用播放测速（false 时仅做搜索检测）
  // episodeCount: 每个视频源测试的最大集数
  // duration: 每次测速持续时间（毫秒）
  // concurrent: 搜索+测速模式下的总并发数（enable=true 时覆盖 search.concurrent）
  playSpeedTest: {
    enable: true,
    episodeCount: 3,
    duration: 5000,
    concurrent: 3,
  },
};
