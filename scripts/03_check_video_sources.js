const fs = require('fs');
const path = require('path');
const https = require('https');
const Table = require('cli-table3');
const axios = require('axios');
const config = require('../config');

const SEARCH_STATUS = { SUCCESS: 'success', NO_RESULTS: 'no_results', FAILED: 'failed' };

const SOURCE_FILE = path.join(__dirname, '..', 'tv_source', 'LunaTV', 'LunaTV-processed.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'tv_source', 'LunaTV', 'LunaTV-check-result.json');
const LOG_FILE = path.join(__dirname, '..', 'log.txt');

let completedCount = 0;
let totalCount = 0;
const logEntries = [];
const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: !config.skipSslVerification }),
});

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const clearLine = () => process.stdout.write('\r\x1b[K');
const fmtMs = (ms) => (ms == null ? '----' : `${ms}ms`);
const proxyUrl = (url, use) => (use ? `${config.proxy.url}/${url}` : url);

function log(msg, name = null) {
  const line = `[${new Date().toLocaleTimeString('zh-CN')}] ${name ? `[${name}] ` : ''}${msg}`;
  if (config.logToFile) logEntries.push(line);
}

function saveLog() {
  if (!config.logToFile || !logEntries.length) return;
  fs.writeFileSync(LOG_FILE, logEntries.join('\n'), 'utf-8');
  console.log(`[信息] 日志已保存: ${LOG_FILE}`);
}

function loadSources() {
  const data = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf-8'));
  const sources = Object.values(data.api_site).map((s) => ({
    id: s.id,
    name: s.name,
    api: s.api,
    detail: s.detail || s.api,
    isAdult: s.isAdult || false,
  }));
  console.log(`[信息] 已加载 ${sources.length} 个视频源`);
  return sources;
}

async function runWithLimit(tasks, limit, onProgress) {
  const results = new Array(tasks.length);
  let index = 0;
  async function runNext() {
    const i = index++;
    if (i >= tasks.length) return;
    results[i] = await tasks[i]();
    if (onProgress) onProgress(i, results[i]);
    await runNext();
  }
  await Promise.all(Array(Math.min(limit, tasks.length)).fill().map(runNext));
  return results;
}

async function checkSearch(api, keyword) {
  for (let i = 1; i <= config.check.maxRetry; i++) {
    const startTime = Date.now();
    try {
      const url = proxyUrl(`${api}?ac=list&wd=${encodeURIComponent(keyword)}&pg=1`, config.proxy.check);
      const res = await axiosInstance.get(url, {
        timeout: config.check.timeout,
        headers: config.check.headers,
      });
      const duration = Date.now() - startTime;
      const list = res.data?.list || [];
      return list.length
        ? { status: SEARCH_STATUS.SUCCESS, duration, firstVideo: list[0] }
        : { status: SEARCH_STATUS.NO_RESULTS, duration, firstVideo: null };
    } catch {
      if (i < config.check.maxRetry) await delay(config.check.retryDelay);
    }
  }
  return { status: SEARCH_STATUS.FAILED, duration: null, firstVideo: null };
}

async function getPlayLinks(api, vodId) {
  try {
    const url = proxyUrl(`${api}?ac=detail&ids=${vodId}`, config.proxy.check);
    const res = await axiosInstance.get(url, { timeout: 5000, headers: config.check.headers });
    const video = res.data?.list?.[0];
    if (!video?.vod_play_url) return [];
    const sources = (video.vod_play_from || '').split('$$$');
    const playUrls = video.vod_play_url.split('$$$');
    let idx = 0;
    if (sources.length > 1) {
      const m3u8Idx = sources.findIndex((s) => s.toLowerCase().includes('m3u8'));
      if (m3u8Idx >= 0) idx = m3u8Idx;
    }
    const selectedUrl = playUrls[idx] || playUrls[0];
    if (!selectedUrl) return [];
    return selectedUrl
      .split('#')
      .map((ep) => {
        const i = ep.indexOf('$');
        if (i > 0) return { name: ep.substring(0, i) || '未知', url: ep.substring(i + 1) };
        return ep.startsWith('http') ? { name: '播放链接', url: ep } : null;
      })
      .filter((ep) => ep?.url?.startsWith('http'));
  } catch {
    return [];
  }
}

async function testPlaySpeed(videoUrl) {
  if (!videoUrl?.startsWith('http')) return { success: false, duration: 0, error: 'Invalid URL', speed: 0 };
  const playUrl = proxyUrl(videoUrl, config.proxy.play);
  const startTime = Date.now();
  let downloadedBytes = 0;
  try {
    const res = await axiosInstance({
      method: 'get',
      url: playUrl,
      responseType: 'stream',
      timeout: 5000,
      headers: config.check.headers,
    });
    return new Promise((resolve) => {
      const stream = res.data;
      stream.on('data', (chunk) => (downloadedBytes += chunk.length));
      const timeout = setTimeout(() => {
        stream.destroy();
        const duration = Date.now() - startTime;
        resolve({ success: true, duration, speed: downloadedBytes / (duration / 1000) });
      }, config.playSpeedTest.duration);
      stream.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ success: false, duration: Date.now() - startTime, error: err.message, speed: 0 });
      });
      stream.on('end', () => {
        clearTimeout(timeout);
        const duration = Date.now() - startTime;
        resolve({ success: true, duration, speed: downloadedBytes / (duration / 1000) });
      });
    });
  } catch (err) {
    return { success: false, duration: Date.now() - startTime, error: err.message, speed: 0 };
  }
}

async function testSource(source) {
  const keyword = source.isAdult ? config.check.adultKeyword : config.check.keyword;
  log(`开始测试`, source.name);
  const searchResult = await checkSearch(source.api, keyword);
  const result = {
    id: source.id,
    name: source.name,
    api: source.api,
    detail: source.detail,
    isAdult: source.isAdult,
    status: 'search_failed',
    search: { status: searchResult.status, duration: searchResult.duration },
    play: { tests: [], avgSpeed: null },
  };
  if (searchResult.status !== SEARCH_STATUS.SUCCESS) return result;
  if (!config.playSpeedTest.enable) {
    result.status = 'available';
    return result;
  }
  const playLinks = await getPlayLinks(source.api, searchResult.firstVideo.vod_id);
  log(`找到 ${playLinks.length} 个播放链接`, source.name);
  if (!playLinks.length) {
    result.status = 'play_failed';
    return result;
  }
  const tests = [];
  for (const ep of playLinks.slice(0, config.playSpeedTest.episodeCount)) {
    log(`测速: ${ep.name}`, source.name);
    const res = await testPlaySpeed(ep.url);
    tests.push({ episode: ep.name, ...res });
    log(res.success ? `速度: ${res.speed.toFixed(2)} B/s` : `失败: ${res.error}`, source.name);
  }
  const successTests = tests.filter((t) => t.success);
  result.play = {
    tests,
    avgSpeed: successTests.length ? successTests.reduce((s, t) => s + t.speed, 0) / successTests.length : null,
  };
  result.status = result.play.avgSpeed != null ? 'available' : 'play_failed';
  return result;
}

function updateProgress(name) {
  completedCount++;
  const pct = Math.round((completedCount / totalCount) * 100);
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  clearLine();
  process.stdout.write(`[${bar}] ${pct}% (${completedCount}/${totalCount}) ${name}`);
}

function displayResults(results) {
  clearLine();
  console.log('');
  console.log('[检测结果]');
  console.log('');
  const fullMode = config.playSpeedTest.enable;
  const sorted = [...results].sort((a, b) => {
    const statusOrder = { success: 0, no_results: 1, failed: 2 };
    const ao = statusOrder[a.search.status] ?? 3;
    const bo = statusOrder[b.search.status] ?? 3;
    if (ao !== bo) return ao - bo;
    if (fullMode && a.play.avgSpeed != null && b.play.avgSpeed != null) return b.play.avgSpeed - a.play.avgSpeed;
    if (fullMode && a.play.avgSpeed != null) return -1;
    if (fullMode && b.play.avgSpeed != null) return 1;
    return (a.search.duration || Infinity) - (b.search.duration || Infinity);
  });
  const table = new Table({
    head: fullMode ? ['#', '视频源', '搜索', '耗时', '播放', '速度', '状态'] : ['#', '视频源', '状态', '耗时'],
    style: { head: ['cyan'] },
    colWidths: fullMode ? [4, 14, 6, 10, 8, 16, 16] : [6, 16, 16, 10],
  });
  let rank = 1;
  for (const r of sorted) {
    const icon = r.search.status === SEARCH_STATUS.SUCCESS ? '✓' : '✗';
    if (fullMode) {
      const successCount = r.play.tests.filter((t) => t.success).length;
      const playOk = r.status === 'available';
      table.push([
        playOk ? rank++ : '-',
        r.name,
        icon,
        fmtMs(r.search.duration),
        r.play.tests.length ? `${successCount}/${r.play.tests.length}` : '-',
        playOk ? `${r.play.avgSpeed.toFixed(0)} B/s` : '-',
        r.status,
      ]);
    } else {
      table.push([
        r.search.status === SEARCH_STATUS.SUCCESS ? rank++ : '-',
        r.name,
        `${icon} ${r.search.status}`,
        fmtMs(r.search.duration),
      ]);
    }
  }
  console.log(table.toString());
  console.log(
    `\n[统计] 总: ${results.length} | 搜索成功: ${results.filter((r) => r.search.status === SEARCH_STATUS.SUCCESS).length}${fullMode ? ` | 播放成功: ${results.filter((r) => r.play.avgSpeed != null).length}` : ''}`
  );
}

function saveResults(results, duration) {
  const data = {
    date: new Date().toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
    playSpeedTestEnabled: config.playSpeedTest.enable,
    keyword: config.check.keyword,
    adultKeyword: config.check.adultKeyword,
    proxyUrl: config.proxy.url,
    useProxy: { search: config.proxy.check, play: config.proxy.play },
    duration: `${duration}s`,
    stats: {
      total: results.length,
      searchOk: results.filter((r) => r.search.status === SEARCH_STATUS.SUCCESS).length,
    },
    results,
  };
  if (config.playSpeedTest.enable) data.stats.playOk = results.filter((r) => r.play.avgSpeed != null).length;
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[信息] 结果已保存: ${OUTPUT_FILE}`);
}

async function main() {
  const mode = config.playSpeedTest.enable
    ? `搜索 + 播放测速 (${config.playSpeedTest.episodeCount}集 × ${config.playSpeedTest.duration / 1000}s)`
    : '仅搜索检测';
  console.log(`\n[视频源检测] 模式: ${mode}`);
  const sources = loadSources();
  totalCount = sources.length;
  const startTime = Date.now();
  const concurrent = config.playSpeedTest.enable ? config.playSpeedTest.concurrent : config.check.concurrent;
  const results = await runWithLimit(
    sources.map((s) => () => testSource(s)),
    concurrent,
    (_, r) => updateProgress(r.name)
  );
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  displayResults(results);
  saveResults(results, duration);
  saveLog();
  console.log(`\n[完成] 耗时 ${duration}s`);
}

main().catch(console.error);
