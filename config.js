module.exports = {
  // 是否跳过 SSL 证书验证
  skipSslVerification: false,
  // 是否记录详细日志到文件
  logToFile: true,

  // 代理配置
  // url: 代理服务器地址
  // download: 下载时是否使用代理
  // check: 搜索检测时是否使用代理
  // play: 播放测速时是否使用代理
  proxy: {
    url: 'https://kuayu.hellow.eu.org',
    download: true,
    check: true,
    play: false,
  },

  // 搜索检测配置（用于检测视频源是否可访问、搜索是否正常）
  // timeout: 请求超时时间（毫秒）
  // concurrent: 并发请求数
  // maxRetry: 最大重试次数
  // retryDelay: 重试间隔（毫秒）
  // keyword: 普通视频搜索关键词
  // adultKeyword: 成人视频搜索关键词
  // headers: 请求头
  check: {
    timeout: 5000,
    concurrent: 20,
    maxRetry: 2,
    retryDelay: 1000,
    keyword: '斗罗大陆',
    adultKeyword: '三上悠',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      'Accept':
        'application/json, text/html, application/xhtml+xml, application/xml;q=0.9, image/avif, image/webp, image/apng, */*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  },

  // 播放测速配置（用于测试视频源的实际播放速度）
  // enable: 是否启用播放测速（false 时只做搜索检测）
  // episodeCount: 每个视频源测试的最大集数
  // duration: 每次测速持续时间（毫秒）
  // concurrent: 并发测速数
  playSpeedTest: {
    enable: true,
    episodeCount: 3,
    duration: 5000,
    concurrent: 3,
  },
};
