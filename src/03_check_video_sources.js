/**
 * 视频源可用性检测
 *
 * 检测流程：
 * 1. 多关键词搜索（按 config 配置的关键词列表依次尝试）
 * 2. 无关键词兜底（部分源不支持关键词搜索但 ac=list 可返回列表）
 * 3. 获取详情 → 解析播放链接
 * 4. 验证 M3U8 链（自动追踪 Master Playlist → Media Playlist）
 * 5. 验证视频分片内容（支持 MPEG-TS / AES-128 加密 / PNG/JPEG 伪装）
 * 6. 真实视频分片测速（5s 下载测速）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const Table = require('cli-table3');
const axios = require('axios');
const config = require('./config.js');

// ==================== 常量 ====================

const SOURCE_FILE = path.join(__dirname, '..', 'tv_source', 'LunaTV', 'LunaTV-processed.json');
const OUTPUT_FILE = path.join(__dirname, '..', 'tv_source', 'LunaTV', 'LunaTV-check-result.json');
const LOG_FILE = path.join(__dirname, '..', 'tv_source', 'LunaTV', 'check-log.txt');

const SEARCH_STATUS = { SUCCESS: 'success', FAILED: 'failed' };
const SOURCE_STATUS = {
  SEARCH_FAILED: 'search_failed',
  DETAIL_FAILED: 'detail_failed',
  PARSE_FAILED: 'parse_failed',
  M3U8_INVALID: 'm3u8_invalid',
  SEGMENT_INVALID: 'segment_invalid',
  AVAILABLE: 'available',
};

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: !config.http.skipSslVerification }),
});

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const clearLine = () => process.stdout.write('\r\x1b[K');

/**
 * 代理回退辅助函数
 *
 * 设计：
 *   - 如果 config.proxy.play = true → 直接用代理，不回退
 *   - 如果 config.proxy.play = false 且配置了代理 → 先直连(重试1次)，失败回退代理
 *   - 如果没有配置代理（url 为空）→ 直连，不回退
 *
 * @param {string} url - 请求URL
 * @param {function(useProxy: boolean): Promise} requestFn - 实际请求函数，接收 useProxy 参数
 * @param {string} label - 日志标签
 */
async function withProxyFallback(url, requestFn, label = '') {
  const hasProxy = !!config.proxy.url;

  // 场景1: 配置了用代理 → 直接用，不回退
  if (config.proxy.play) {
    return requestFn(true);
  }

  // 场景2: 配置了不用代理，但有代理可用 → 先直连(重试1次)，失败回退代理
  if (hasProxy) {
    let result = await requestFn(false);
    if (result.success) return result;
    log(`${label} 直连失败(${result.error || '?'})，重试中...`);
    result = await requestFn(false);
    if (result.success) return result;
    log(`${label} 直连重试仍失败，回退代理`);
    return requestFn(true);
  }

  // 场景3: 没有代理可用 → 直连
  return requestFn(false);
}

const proxyUrl = (url, use) => (use && config.proxy.url ? `${config.proxy.url}/${url}` : url);

// ==================== 日志 ====================

const logEntries = [];
function log(msg, name = null) {
  if (!config.log.toFile) return;
  const line = `[${new Date().toLocaleTimeString('zh-CN')}] ${name ? `[${name}] ` : ''}${msg}`;
  logEntries.push(line);
}

function saveLog() {
  if (!logEntries.length) return;
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOG_FILE, logEntries.join('\n'), 'utf-8');
  console.log(`\n[信息] 日志已保存: ${LOG_FILE}`);
}

// ==================== URL 解析 ====================

/**
 * 从 M3U8 中正确解析引用 URL
 * M3U8 中的引用可能以三种形式出现：
 *   - http://...    → 绝对 URL
 *   /path/file     → 绝对路径（基于原域名）
 *   relative/file  → 相对路径（基于父 M3U8 所在目录）
 */
function resolveM3U8Url(m3u8Url, ref) {
  if (ref.startsWith('http')) return ref;

  if (ref.startsWith('/')) {
    try {
      const u = new URL(m3u8Url);
      u.pathname = ref;
      u.search = '';
      return u.href;
    } catch {
      const idx = m3u8Url.indexOf('/', 8);
      if (idx > 0) return m3u8Url.substring(0, idx) + ref;
      return m3u8Url + ref;
    }
  }

  const baseDir = m3u8Url.replace(/[?#].*$/, '').replace(/\/[^/]*$/, '/');
  return baseDir + ref;
}

// ==================== 加载源 ====================

function loadSources() {
  const data = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf-8'));
  if (!data?.api_site) throw new Error(`输入文件格式无效: 缺少 api_site 字段 (${SOURCE_FILE})`);
  return Object.values(data.api_site).map((s) => ({
    id: s.id,
    name: s.name,
    api: s.api,
    detail: s.detail || s.api,
    isAdult: s.isAdult || false,
  }));
}

// ==================== 并发控制 ====================

async function runWithLimit(tasks, limit, onProgress) {
  const results = new Array(tasks.length);
  let index = 0;
  if (limit < 1) limit = 1;
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

// ==================== 阶段 1：多关键词搜索 ====================

async function checkSearch(api, keywords) {
  // 策略 1: 按顺序尝试每个关键词
  for (const kw of keywords) {
    if (!kw) continue;
    for (let retry = 1; retry <= config.search.maxRetry; retry++) {
      try {
        const url = proxyUrl(`${api}?ac=list&wd=${encodeURIComponent(kw)}&pg=1`, config.proxy.search);
        const start = Date.now();
        const res = await axiosInstance.get(url, {
          timeout: config.http.timeout,
          headers: config.http.headers,
        });
        const duration = Date.now() - start;
        const list = res.data?.list || [];
        if (list.length > 0) {
          return {
            status: SEARCH_STATUS.SUCCESS,
            duration,
            firstVideo: list[0],
            keyword: kw,
            resultCount: list.length,
          };
        }
        break;
      } catch (err) {
        log(`搜索失败 (${kw}, 重试${retry}/${config.search.maxRetry}): ${err.message}`);
        if (retry < config.search.maxRetry) await delay(config.search.retryDelay);
      }
    }
    await delay(200);
  }

  // 策略 2: 无关键词列表，不标记为搜索成功（这些源不支持关键词搜索）
  for (let retry = 1; retry <= config.search.maxRetry; retry++) {
    try {
      const url = proxyUrl(`${api}?ac=list&pg=1`, config.proxy.search);
      const res = await axiosInstance.get(url, {
        timeout: config.http.timeout,
        headers: config.http.headers,
      });
      const list = res.data?.list || [];
      if (list.length > 0) {
        return {
          status: SEARCH_STATUS.FAILED,
          duration: null,
          firstVideo: null,
          keyword: keywords[0] || '',
          fallbackList: list,
          fallbackReason: '不支持关键词搜索(仅列表可用)',
        };
      }
    } catch {
      /* 忽略 */
    }
  }

  return { status: SEARCH_STATUS.FAILED, duration: null, firstVideo: null, keyword: keywords[0] || '' };
}

// ==================== 阶段 2：获取详情 + 解析 M3U8 URL ====================

async function getPlayInfo(api, vodId) {
  try {
    const url = proxyUrl(`${api}?ac=detail&ids=${vodId}`, config.proxy.search);
    const start = Date.now();
    const res = await axiosInstance.get(url, { timeout: config.http.timeout, headers: config.http.headers });
    const duration = Date.now() - start;
    const video = res.data?.list?.[0];
    if (!video) return { success: false, reason: 'detail_empty' };
    if (!video.vod_play_url) return { success: false, reason: 'no_vod_play_url' };
    return { success: true, duration, video };
  } catch (err) {
    return { success: false, reason: `detail_error: ${err.code || err.message}` };
  }
}

function extractM3U8Url(vodPlayUrl, vodPlayFrom) {
  const sources = (vodPlayFrom || '').split('$$$');
  const playUrls = vodPlayUrl.split('$$$');
  let idx = 0;
  if (sources.length > 1) {
    const m3u8Idx = sources.findIndex((s) => s.toLowerCase().includes('m3u8'));
    if (m3u8Idx >= 0 && m3u8Idx < playUrls.length) idx = m3u8Idx;
  }
  const selected = playUrls[idx];
  if (!selected) return null;
  const episodes = selected
    .split('#')
    .map((ep) => {
      const sep = ep.indexOf('$');
      if (sep > 0) return { name: ep.substring(0, sep) || '未知', url: ep.substring(sep + 1) };
      return ep.startsWith('http') ? { name: '播放链接', url: ep } : null;
    })
    .filter((e) => e?.url?.startsWith('http'));
  return episodes.length > 0 ? episodes : null;
}

// ==================== 阶段 3：验证 M3U8 并获取分片 URL ====================

async function verifyM3U8AndGetSegment(m3u8Url, depth = 0) {
  if (depth > 3) return { success: false, reason: 'max_depth', chain: [] };
  const chain = [];

  const fetchM3U8 = async (useProxy) => {
    const testUrl = proxyUrl(m3u8Url, useProxy);
    // 统一用全局超时，最长不超过 10s
    const hasProxy = !!config.proxy.url;
    const timeout = (useProxy || !hasProxy) ? Math.min(config.http.timeout * 2, 10000) : config.http.timeout;
    try {
      const res = await axiosInstance({
        method: 'get',
        url: testUrl,
        responseType: 'text',
        timeout,
        headers: config.http.headers,
      });
      return { success: true, data: res.data, headers: res.headers };
    } catch (err) {
      return { success: false, error: err.code || err.message };
    }
  };

  const m3u8Result = await withProxyFallback(m3u8Url, fetchM3U8, 'M3U8');
  if (!m3u8Result.success) return { success: false, reason: `m3u8_error: ${m3u8Result.error}`, chain };

  const body = m3u8Result.data;
  chain.push({ url: m3u8Url, size: body.length, contentType: m3u8Result.headers?.['content-type'] });
  if (!body.startsWith('#EXTM3U')) return { success: false, reason: 'not_m3u8', chain };

  const lines = body.split('\n');
  const tags = [];
  const refs = [];
  const hasEncryption = body.includes('EXT-X-KEY:METHOD=AES-128');

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#EXT-X-STREAM-INF:')) tags.push('stream_inf');
    else if (t.startsWith('#EXTINF:')) tags.push('extinf');
    else if (!t.startsWith('#')) refs.push(t);
  }

  if (tags.includes('stream_inf') && !tags.includes('extinf')) {
    if (refs.length === 0) return { success: false, reason: 'master_no_children', chain };
    const childUrl = resolveM3U8Url(m3u8Url, refs[0]);
    const childResult = await verifyM3U8AndGetSegment(childUrl, depth + 1);
    chain.push(...childResult.chain);
    return {
      success: childResult.success,
      reason: childResult.reason,
      chain,
      segmentUrl: childResult.segmentUrl,
      hasEncryption: childResult.hasEncryption,
    };
  }

  if (tags.includes('extinf') && refs.length > 0) {
    const segmentUrl = resolveM3U8Url(m3u8Url, refs[0]);
    return {
      success: true,
      reason: hasEncryption ? 'media_playlist_encrypted' : 'media_playlist',
      chain,
      segmentUrl,
      hasEncryption,
    };
  }

  return { success: false, reason: 'unknown_m3u8_format', chain };
}

// ==================== 阶段 4：验证分片内容 ====================

function hasTSSyncAtOffset(buf, maxOffset = 500) {
  const len = buf.length;
  for (let offset = 0; offset < Math.min(maxOffset, len - 188); offset++) {
    let count = 0;
    for (let i = offset; i < Math.min(len, offset + 1880); i += 188) {
      if (buf[i] === 0x47) count++;
    }
    if (count >= 5) return { found: true, offset, count };
  }
  return { found: false };
}

async function verifySegment(segmentUrl, m3u8Info = {}) {
  const fetchChunk = async (useProxy) => {
    const testUrl = proxyUrl(segmentUrl, useProxy);
    const hasProxy = !!config.proxy.url;
    const timeout = (useProxy || !hasProxy) ? Math.min(config.http.timeout * 2, 10000) : config.http.timeout;
    try {
      const res = await axiosInstance({
        method: 'get',
        url: testUrl,
        responseType: 'stream',
        timeout,
        headers: { ...config.http.headers, Range: 'bytes=0-131072' },
      });
      const chunk = await new Promise((resolve, reject) => {
        let data = Buffer.alloc(0);
        const stream = res.data;
        stream.on('data', (d) => {
          data = Buffer.concat([data, d]);
          if (data.length >= 65536) {
            stream.destroy();
            resolve(data);
          }
        });
        stream.on('end', () => resolve(data));
        stream.on('error', (err) => reject(err));
      });
      return { success: true, data: chunk, status: res.status };
    } catch (err) {
      return { success: false, error: err.code || err.message };
    }
  };

  const result = await withProxyFallback(segmentUrl, fetchChunk, '分片');
  if (!result.success) return { success: false, segType: 'error', error: result.error };

  const chunk = result.data;
  const len = chunk.length;
  const firstBytesHex = len >= 4 ? chunk.slice(0, 4).toString('hex') : 'too_short';
  const httpStatus = result.status;
  const header = chunk.toString('utf8', 0, Math.min(512, len));

  if (chunk[0] === 0x47) return { success: true, segType: 'MPEG-TS', bytesRead: len, httpStatus };
  if (firstBytesHex === '66747970') return { success: true, segType: 'MP4', bytesRead: len, httpStatus };
  if (firstBytesHex === '1a45dfa3') return { success: true, segType: 'WebM', bytesRead: len, httpStatus };
  if (header.startsWith('#EXTM3U')) return { success: true, segType: 'M3U8 (nested)', bytesRead: len, httpStatus };
  if (header.includes('EXT-X-KEY') && len < 5000)
    return { success: true, segType: 'M3U8_with_key', bytesRead: len, httpStatus };

  if (len >= 512) {
    const tsCheck = hasTSSyncAtOffset(chunk);
    if (tsCheck.found)
      return { success: true, segType: `MPEG-TS (offset=${tsCheck.offset})`, bytesRead: len, httpStatus };
  }

  if (m3u8Info.hasEncryption && len > 50000)
    return { success: true, segType: 'AES-128 encrypted', bytesRead: len, httpStatus };

  if (len >= 512) {
    const textRatio = (header.match(/[\x20-\x7E]/g) || []).length / header.length;
    if (textRatio < 0.05 && len > 100000)
      return { success: true, segType: 'likely_encrypted_video', bytesRead: len, httpStatus };
  }

  if (header.includes('<html') || header.includes('<!DOCTYP'))
    return { success: false, segType: 'HTML', bytesRead: len, httpStatus, error: 'HTML' };
  if (header.startsWith('{') || header.startsWith('['))
    return { success: false, segType: 'JSON', bytesRead: len, httpStatus, error: 'JSON' };
  if (len < 50000 && (firstBytesHex === '89504e47' || firstBytesHex.startsWith('ffd8')))
    return {
      success: false,
      segType: firstBytesHex === '89504e47' ? 'PNG' : 'JPEG',
      bytesRead: len,
      httpStatus,
      error: '纯图片',
    };
  if (len > 100000)
    return { success: true, segType: `unknown_but_large(${firstBytesHex})`, bytesRead: len, httpStatus };
  return { success: false, segType: `Unknown (${firstBytesHex})`, bytesRead: len, httpStatus, error: '无法识别' };
}

// ==================== 阶段 5：分片测速 ====================

async function testSegmentSpeed(segmentUrl) {
  const doSpeedTest = async (useProxy) => {
    const testUrl = proxyUrl(segmentUrl, useProxy);
    const startTime = Date.now();
    let downloadedBytes = 0;
    try {
      const res = await axiosInstance({
        method: 'get',
        url: testUrl,
        responseType: 'stream',
        timeout: Math.min(config.http.timeout * 2, 10000),
        headers: config.http.headers,
      });
      return new Promise((resolve) => {
        const stream = res.data;
        stream.on('data', (chunk) => (downloadedBytes += chunk.length));
        const timeout = setTimeout(() => {
          stream.destroy();
          const elapsed = Date.now() - startTime;
          resolve({
            success: true,
            duration: elapsed,
            speedBytesPerSec: elapsed > 0 ? downloadedBytes / (elapsed / 1000) : 0,
            bytesTotal: downloadedBytes,
          });
        }, config.playSpeedTest.duration);
        stream.on('end', () => {
          clearTimeout(timeout);
          const elapsed = Date.now() - startTime;
          resolve({
            success: true,
            duration: elapsed,
            speedBytesPerSec: elapsed > 0 ? downloadedBytes / (elapsed / 1000) : 0,
            bytesTotal: downloadedBytes,
          });
        });
        stream.on('error', (err) => {
          clearTimeout(timeout);
          resolve({
            success: false,
            duration: Date.now() - startTime,
            error: err.message,
            speedBytesPerSec: 0,
            bytesTotal: downloadedBytes,
          });
        });
      });
    } catch (err) {
      return {
        success: false,
        duration: Date.now() - startTime,
        error: err.code || err.message,
        speedBytesPerSec: 0,
        bytesTotal: 0,
      };
    }
  };
  return withProxyFallback(segmentUrl, doSpeedTest, '测速');
}

// ==================== 完整检测一个源 ====================

async function testSource(source) {
  const keywords = source.isAdult ? config.search.adultKeywords : config.search.keywords;
  const searchKeywords = Array.isArray(keywords) ? keywords.filter((k) => k) : [keywords].filter((k) => k);
  log(`开始测试`, source.name);

  const tStart = Date.now();
  const result = {
    id: source.id,
    name: source.name,
    api: source.api,
    detail: source.detail,
    isAdult: source.isAdult,
    status: SOURCE_STATUS.SEARCH_FAILED,
    searchDuration: null,
    usedKeyword: null,
    segmentType: null,
    speedBytesPerSec: null,
    errorDetail: null,
    totalTime: null,
  };

  // ---- 阶段 1：多关键词搜索 ----
  const searchResult = await checkSearch(source.api, searchKeywords);
  result.searchDuration = searchResult.duration;
  result.usedKeyword = searchResult.keyword;
  if (searchResult.status !== SEARCH_STATUS.SUCCESS) {
    result.status = SOURCE_STATUS.SEARCH_FAILED;
    result.errorDetail = `所有关键词搜索均失败 (关键词: ${searchKeywords.join(', ')})`;
    result.totalTime = Date.now() - tStart;
    log(`搜索失败 (${result.errorDetail})`, source.name);
    return result;
  }
  log(`搜索成功: "${searchResult.keyword}" → ${searchResult.firstVideo?.vod_name || '?'}`, source.name);

  // ---- 阶段 2：获取详情 ----
  const detailResult = await getPlayInfo(source.api, searchResult.firstVideo.vod_id);
  if (!detailResult.success) {
    result.status = SOURCE_STATUS.DETAIL_FAILED;
    result.errorDetail = detailResult.reason;
    result.totalTime = Date.now() - tStart;
    log(`详情失败: ${detailResult.reason}`, source.name);
    return result;
  }
  log(`详情获取成功: ${detailResult.video.vod_name}`, source.name);

  // ---- 阶段 3：解析 M3U8 URL ----
  const episodes = extractM3U8Url(detailResult.video.vod_play_url, detailResult.video.vod_play_from);
  if (!episodes) {
    result.status = SOURCE_STATUS.PARSE_FAILED;
    result.errorDetail = '从 vod_play_url 中未解析出有效 HTTP 链接';
    result.totalTime = Date.now() - tStart;
    log(`解析失败: ${result.errorDetail}`, source.name);
    return result;
  }
  log(`解析到 ${episodes.length} 个播放链接`, source.name);

  // ---- 阶段 4：验证 M3U8 并获取分片 ----
  const m3u8Segment = await verifyM3U8AndGetSegment(episodes[0].url);
  if (!m3u8Segment.success || !m3u8Segment.segmentUrl) {
    result.status = SOURCE_STATUS.M3U8_INVALID;
    result.errorDetail = m3u8Segment.reason;
    result.totalTime = Date.now() - tStart;
    log(`M3U8 验证失败: ${m3u8Segment.reason}`, source.name);
    return result;
  }
  log(`M3U8 验证通过`, source.name);
  if (m3u8Segment.hasEncryption) log(`(M3U8 有 AES-128 加密标记)`, source.name);

  // ---- 阶段 5：验证分片内容 ----
  const m3u8Info = { hasEncryption: m3u8Segment.hasEncryption };
  const segResult = await verifySegment(m3u8Segment.segmentUrl, m3u8Info);
  result.segmentType = segResult.segType;
  if (!segResult.success) {
    result.status = SOURCE_STATUS.SEGMENT_INVALID;
    result.errorDetail = `分片内容无效: ${segResult.segType}`;
    result.totalTime = Date.now() - tStart;
    log(`分片无效: ${segResult.segType}`, source.name);
    return result;
  }
  log(`分片内容验证通过: ${segResult.segType}`, source.name);

  // ---- 阶段 6：测速 ----
  if (config.playSpeedTest.enable) {
    const speedResult = await testSegmentSpeed(m3u8Segment.segmentUrl);
    result.speedBytesPerSec = speedResult.speedBytesPerSec;
    log(
      speedResult.success
        ? `测速完成: ${(speedResult.speedBytesPerSec / 1024).toFixed(1)} KB/s`
        : `测速失败: ${speedResult.error}`,
      source.name
    );
  }

  result.totalTime = Date.now() - tStart;
  result.status = SOURCE_STATUS.AVAILABLE;
  return result;
}

// ==================== 显示结果 ====================

function displayResults(results) {
  clearLine();
  console.log('\n视频源检测结果：\n');

  const sorted = [...results].sort((a, b) => {
    if (a.status === SOURCE_STATUS.AVAILABLE && b.status !== SOURCE_STATUS.AVAILABLE) return -1;
    if (a.status !== SOURCE_STATUS.AVAILABLE && b.status === SOURCE_STATUS.AVAILABLE) return 1;
    return (b.speedBytesPerSec || 0) - (a.speedBytesPerSec || 0);
  });

  const table = new Table({
    head: ['#', '视频源', '状态', '关键词', '分片类型', '速度'],
    style: { head: ['cyan'] },
    colWidths: [4, 14, 18, 18, 22, 16],
  });

  let rank = 1;
  for (const r of sorted) {
    if (r.status === SOURCE_STATUS.AVAILABLE) {
      const speedStr = r.speedBytesPerSec ? `${(r.speedBytesPerSec / 1024).toFixed(1)} KB/s` : '-';
      table.push([rank++, r.name, '✓ 可用', r.usedKeyword || '-', r.segmentType || '-', speedStr]);
    } else {
      table.push(['-', r.name, `✗ ${r.status}`, r.usedKeyword || '-', '-', '-']);
    }
  }

  console.log(table.toString());

  const total = results.length;
  const avail = results.filter((r) => r.status === SOURCE_STATUS.AVAILABLE).length;
  console.log(`\n[统计] 总数: ${total} | 可用: ${avail} | 失败: ${total - avail}`);

  // 时间统计
  const withTime = results.filter((r) => r.totalTime != null);
  if (withTime.length > 0) {
    const totalTime = withTime.reduce((s, r) => s + r.totalTime, 0);
    const avgTime = totalTime / withTime.length;
    const times = withTime.map((r) => r.totalTime).sort((a, b) => a - b);
    const availTimes =
      avail > 0 ? results.filter((r) => r.status === SOURCE_STATUS.AVAILABLE).map((r) => r.totalTime) : [];
    console.log(
      `[时间] 单个源平均 ${(avgTime / 1000).toFixed(1)}s | 最快 ${(times[0] / 1000).toFixed(1)}s | 最慢 ${(times[times.length - 1] / 1000).toFixed(1)}s`
    );
    if (availTimes.length > 0)
      console.log(
        `[时间] 可用源平均 ${(availTimes.reduce((s, t) => s + t, 0) / availTimes.length / 1000).toFixed(1)}s/个`
      );
  }

  // 失败原因分布
  const failBreakdown = {};
  for (const r of results) {
    if (r.status !== SOURCE_STATUS.AVAILABLE) failBreakdown[r.status] = (failBreakdown[r.status] || 0) + 1;
  }
  if (Object.keys(failBreakdown).length > 0) {
    console.log('\n失败原因分布:');
    for (const [status, count] of Object.entries(failBreakdown)) console.log(`  ${status}: ${count} 个`);
  }
}

// ==================== 保存结果 ====================

function saveResults(results, duration) {
  const compatibleResults = results.map((r) => ({
    id: r.id,
    name: r.name,
    api: r.api,
    detail: r.detail,
    isAdult: r.isAdult,
    status: r.status,
    search: { duration: r.searchDuration || null, usedKeyword: r.usedKeyword },
    play: { avgSpeed: r.speedBytesPerSec || null, segmentType: r.segmentType },
    errorDetail: r.errorDetail,
  }));

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
    keywords: { normal: config.search.keywords, adult: config.search.adultKeywords },
    proxyUrl: config.proxy.url,
    useProxy: { search: config.proxy.search, play: config.proxy.play },
    duration: `${duration}s`,
    stats: { total: results.length, available: results.filter((r) => r.status === SOURCE_STATUS.AVAILABLE).length },
    results: compatibleResults,
    rawResults: results,
  };

  const dir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\n[信息] 结果已保存: ${OUTPUT_FILE}`);
}

// ==================== 主流程 ====================

async function main() {
  const mode = config.playSpeedTest.enable
    ? '多关键词搜索 + M3U8链追踪 + 视频分片验证 + 播放测速'
    : '多关键词搜索 + M3U8链追踪 + 视频分片验证（不含播放测速）';
  console.log(`\n[视频源检测] 模式: ${mode}`);
  console.log(`[配置] 普通关键词: ${config.search.keywords.join(', ')}`);
  console.log(`[配置] 成人关键词: ${config.search.adultKeywords.join(', ')}`);
  console.log(`[配置] 测速时长: ${config.playSpeedTest.duration / 1000}s/源`);

  const sources = loadSources();
  console.log(`[信息] 已加载 ${sources.length} 个视频源\n`);

  const totalCount = sources.length;
  let completedCount = 0;
  const startTime = Date.now();
  const concurrent = config.playSpeedTest.enable ? config.playSpeedTest.concurrent : config.search.concurrent;

  const results = await runWithLimit(
    sources.map((s) => async () => {
      const r = await testSource(s);
      completedCount++;
      const pct = Math.round((completedCount / totalCount) * 100);
      const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
      clearLine();
      const speedInfo = r.status === SOURCE_STATUS.AVAILABLE && r.speedBytesPerSec
        ? ` ${(r.speedBytesPerSec / 1024).toFixed(0)}KB/s` : '';
      process.stdout.write(
        `[${bar}] ${pct}% (${completedCount}/${totalCount}) ${r.status === SOURCE_STATUS.AVAILABLE ? '✓' : '✗'} ${r.name}${speedInfo}`
      );
      return r;
    }),
    concurrent
  );

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  displayResults(results);
  saveResults(results, duration);
  saveLog();
  console.log(`\n[完成] 耗时 ${duration}s`);
}

main().catch((err) => { console.error(err); process.exit(1); });
