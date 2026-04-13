const { execSync } = require('child_process');
const path = require('path');
const config = require('./config.js');

const scripts = [
  '01_download_lunatv_config.js',
  '02_process_lunatv_config.js',
  '03_check_video_sources.js',
  '04_convert_ouonnkitv.js',
];

const scriptsDir = path.join(__dirname, 'scripts');

const yn = (v) => (v ? '是' : '否');

function displayWidth(str) {
  let w = 0;
  for (const ch of str) w += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return w;
}

function padEnd(str, width) {
  return str + ' '.repeat(Math.max(0, width - displayWidth(str)));
}

function printConfig() {
  const p = config.proxy;
  const c = config.check;
  const s = config.playSpeedTest;
  const W = 18;

  const items = [
    ['代理地址', p.url || '未设置'],
    ['下载使用代理', yn(p.url && p.download)],
    ['检测使用代理', yn(p.url && p.check)],
    ['测速使用代理', yn(p.url && p.play)],
    ['检测关键词', c.keyword],
    ['成人检测关键词', c.adultKeyword || c.keyword],
    ['检测超时', `${c.timeout}ms`],
    ['检测并发', c.concurrent],
    ['最大重试', `${c.maxRetry} 次`],
    ['重试间隔', `${c.retryDelay}ms`],
    ['跳过SSL验证', yn(config.skipSslVerification)],
    ['记录日志到文件', yn(config.logToFile)],
    ['播放测速', s.enable ? '开启' : '关闭'],
  ];

  if (s.enable) {
    items.push(
      ['测速集数', s.episodeCount],
      ['测速时长', `${s.duration}ms`],
      ['测速并发', s.concurrent],
    );
  }

  console.log('当前配置:');
  for (const [label, value] of items) {
    console.log(`  ${padEnd(label + ':', W)}${value}`);
  }
  console.log('');
}

(async () => {
  console.log('OuonnkiTV 视频源一键检测脚本\n');
  printConfig();

  console.log('2秒后开始执行...\n');
  await new Promise((r) => setTimeout(r, 2000));

  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];
    const scriptPath = path.join(scriptsDir, script);

    console.log(`[${i + 1}/${scripts.length}] 正在执行: ${script}`);

    try {
      execSync(`node "${scriptPath}"`, { stdio: 'inherit', cwd: process.cwd() });
      console.log(`\n>>> [成功] ${script} 执行完成\n`);
    } catch (error) {
      console.error(`\n>>> [失败] ${script} 执行出错`);
      console.error('错误:', error.message);
      process.exit(1);
    }
  }

  console.log('所有脚本执行完成！');
})();
