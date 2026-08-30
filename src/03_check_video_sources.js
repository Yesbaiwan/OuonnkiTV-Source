/**
 * 视频源可用性检测
 *
 * 检测流程：
 * 1. 多关键词搜索（按 config 配置的关键词列表依次尝试）
 * 2. 获取详情 → 解析播放链接
 * 3. 验证 M3U8 链（自动追踪 Master Playlist → Media Playlist）
 * 4. 验证视频分片内容（支持 MPEG-TS / AES-128 加密 / PNG/JPEG 伪装）
 * 5. 真实视频分片测速（5s 下载测速）
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
  timeout: config.http.timeout,
  httpsAgent: new https.Agent({ rejectUnauthorized: !config.http.skipSslVerification }),
});

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const clearLine = () => process.stdout.write('\r\x1b[K');
const fmtDate = () =>
  new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/**
 * 代理回退辅助函数
 *
 * 设计：
 *   - 如果 config.proxy.play = true → 直接用代理，不回退
 *   - 如果 config.proxy.play = false 且配置了代理 → 先直连(重试1次)，失败回退代理
 *   - 如果没有配置代理（url 为空）→ 直连，不回退
 *
 * @param {function(useProxy: boolean): Promise} requestFn - 实际请求函数，接收 useProxy 参数
 * @param {string} label - 日志标签
 * @returns {Promise<object>} 请求结果，附加 usedProxy 字段标记本次是否走了代理
 */
async function withProxyFallback(requestFn, label = '') {
  // 场景1: 配置了用代理 → 直接用，不回退
  if (config.proxy.play) {
    return { ...(await requestFn(true)), usedProxy: true };
  }

  // 场景2: 配置了不用代理，但有代理可用 → 先直连(重试1次)，失败回退代理
  if (config.proxy.url) {
    let result = await requestFn(false);
    if (result.success) return { ...result, usedProxy: false };
    log(`${label} 直连失败(${result.error || '?'})，重试中...`);
    result = await requestFn(false);
    if (result.success) return { ...result, usedProxy: false };
    log(`${label} 直连重试仍失败，回退代理`);
    return { ...(await requestFn(true)), usedProxy: true };
  }

  // 场景3: 没有代理可用 → 直连
  return { ...(await requestFn(false)), usedProxy: false };
}

const proxyUrl = (url, use) => (use && config.proxy.url ? `${config.proxy.url}/${url}` : url);

// 请求超时：走代理或没配代理时放宽到 2 倍（上限 10s）；直连试探用默认超时（失败还可回退代理）
const requestTimeout = (useProxy) =>
  useProxy || !config.proxy.url ? Math.min(config.http.timeout * 2, 10000) : config.http.timeout;

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
 *   - /path/file    → 绝对路径（基于原域名）
 *   - relative/file → 相对路径（基于父 M3U8 所在目录）
 */
function resolveM3U8Url(m3u8Url, ref) {
  if (ref.startsWith('http')) return ref;

  if (ref.startsWith('/')) {
    try {
      const u = new URL(m3u8Url);
      const qIdx = ref.indexOf('?');
      u.pathname = qIdx >= 0 ? ref.slice(0, qIdx) : ref;
      u.search = qIdx >= 0 ? ref.slice(qIdx) : '';
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

async function runWithLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let index = 0;
  if (limit < 1) limit = 1;
  async function runNext() {
    const i = index++;
    if (i >= tasks.length) return;
    results[i] = await tasks[i]();
    await runNext();
  }
  await Promise.all(Array(Math.min(limit, tasks.length)).fill().map(runNext));
  return results;
}

// ==================== 阶段 1：多关键词搜索 ====================

async function checkSearch(api, keywords, name) {
  // 按顺序尝试每个关键词（调用方已过滤空值），命中即返回第一个视频
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
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
        log(`关键词 "${kw}" 无搜索结果`, name);
        break;
      } catch (err) {
        log(`搜索失败 (关键词 "${kw}", 重试${retry}/${config.search.maxRetry}): ${err.message}`, name);
        if (retry < config.search.maxRetry) await delay(config.search.retryDelay);
      }
    }
    // 还有剩余关键词时，明确记录换词重试
    const next = keywords[i + 1];
    if (next) log(`换下一个关键词 "${next}" 继续搜索`, name);
    await delay(200);
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
  if (depth > 3) return { success: false, reason: 'max_depth' };

  const fetchM3U8 = async (useProxy) => {
    const testUrl = proxyUrl(m3u8Url, useProxy);
    const timeout = requestTimeout(useProxy);
    try {
      const res = await axiosInstance({
        method: 'get',
        url: testUrl,
        responseType: 'text',
        timeout,
        headers: config.http.headers,
      });
      return { success: true, data: res.data };
    } catch (err) {
      return { success: false, error: err.code || err.message };
    }
  };

  const m3u8Result = await withProxyFallback(fetchM3U8, 'M3U8');
  if (!m3u8Result.success)
    return { success: false, reason: `m3u8_error: ${m3u8Result.error}`, usedProxy: m3u8Result.usedProxy };

  const body = m3u8Result.data;
  if (!body.startsWith('#EXTM3U')) return { success: false, reason: 'not_m3u8', usedProxy: m3u8Result.usedProxy };

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

  // Master Playlist → 递归追踪第一个子流
  if (tags.includes('stream_inf') && !tags.includes('extinf')) {
    if (refs.length === 0) return { success: false, reason: 'master_no_children', usedProxy: m3u8Result.usedProxy };
    const childUrl = resolveM3U8Url(m3u8Url, refs[0]);
    const childResult = await verifyM3U8AndGetSegment(childUrl, depth + 1);
    return {
      success: childResult.success,
      reason: childResult.reason,
      segmentUrl: childResult.segmentUrl,
      hasEncryption: childResult.hasEncryption,
      usedProxy: childResult.usedProxy ?? m3u8Result.usedProxy,
    };
  }

  // Media Playlist → 取第一个分片
  if (tags.includes('extinf') && refs.length > 0) {
    const segmentUrl = resolveM3U8Url(m3u8Url, refs[0]);
    return {
      success: true,
      reason: hasEncryption ? 'media_playlist_encrypted' : 'media_playlist',
      segmentUrl,
      hasEncryption,
      usedProxy: m3u8Result.usedProxy,
    };
  }

  return { success: false, reason: 'unknown_m3u8_format', usedProxy: m3u8Result.usedProxy };
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

// 分片文件格式魔数：各容器/编码文件的固定头部字节
const SEG_MAGIC = {
  TS_SYNC: 0x47, // MPEG-TS 包同步字节（每 188 字节包首字节）
  MP4: '66747970', // "ftyp" box，MP4/ISO-BMFF 容器
  WEBM: '1a45dfa3', // EBML 头，Matroska/WebM 容器
  PNG: '89504e47', // PNG 签名
  JPEG: 'ffd8', // JPEG 起始标记
};

// 根据分片字节判断真实类型（纯函数，便于单测）
function classifySegment(chunk, hasEncryption) {
  const len = chunk.length;
  const firstBytesHex = len >= 4 ? chunk.slice(0, 4).toString('hex') : 'too_short';
  const header = chunk.toString('utf8', 0, Math.min(512, len));

  let segType = null;
  let error = null;
  if (chunk[0] === SEG_MAGIC.TS_SYNC) segType = 'MPEG-TS';
  else if (firstBytesHex === SEG_MAGIC.MP4) segType = 'MP4';
  else if (firstBytesHex === SEG_MAGIC.WEBM) segType = 'WebM';
  else if (header.startsWith('#EXTM3U')) segType = 'M3U8 (nested)';
  else if (len >= 512) {
    const tsCheck = hasTSSyncAtOffset(chunk);
    if (tsCheck.found) segType = `MPEG-TS (offset=${tsCheck.offset})`;
  }

  if (!segType) {
    if (hasEncryption && len > 50000) segType = 'AES-128 encrypted';
    else if (len > 100000 && (header.match(/[\x20-\x7E]/g) || []).length / header.length < 0.05)
      segType = 'likely_encrypted_video';
    else if (header.includes('<html') || header.includes('<!DOCTYP')) {
      segType = 'HTML';
      error = 'HTML';
    } else if (header.startsWith('{') || header.startsWith('[')) {
      segType = 'JSON';
      error = 'JSON';
    } else if (len < 50000 && (firstBytesHex === SEG_MAGIC.PNG || firstBytesHex.startsWith(SEG_MAGIC.JPEG))) {
      segType = firstBytesHex === SEG_MAGIC.PNG ? 'PNG' : 'JPEG';
      error = '纯图片';
    } else if (len > 100000) segType = `unknown_but_large(${firstBytesHex})`;
    else {
      segType = `Unknown (${firstBytesHex})`;
      error = '无法识别';
    }
  }

  return { success: !error, segType, ...(error ? { error } : {}) };
}

async function verifySegment(segmentUrl, m3u8Info = {}) {
  const fetchChunk = async (useProxy) => {
    const testUrl = proxyUrl(segmentUrl, useProxy);
    const timeout = requestTimeout(useProxy);
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
          if (data.length >= 131072) {
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

  const result = await withProxyFallback(fetchChunk, '分片');
  if (!result.success) return { success: false, segType: 'error', error: result.error, usedProxy: result.usedProxy };

  const classified = classifySegment(result.data, m3u8Info.hasEncryption);
  return {
    ...classified,
    bytesRead: result.data.length,
    httpStatus: result.status,
    usedProxy: result.usedProxy,
  };
}

// ==================== 阶段 5：分片测速 ====================

async function testSegmentSpeed(segmentUrl) {
  const doSpeedTest = async (useProxy) => {
    const testUrl = proxyUrl(segmentUrl, useProxy);
    const startTime = Date.now();
    let downloadedBytes = 0;
    const speedOf = (elapsed) => ({
      success: true,
      duration: elapsed,
      speedBytesPerSec: elapsed > 0 ? downloadedBytes / (elapsed / 1000) : 0,
      bytesTotal: downloadedBytes,
    });
    try {
      const res = await axiosInstance({
        method: 'get',
        url: testUrl,
        responseType: 'stream',
        timeout: requestTimeout(useProxy),
        headers: config.http.headers,
      });
      return new Promise((resolve) => {
        const stream = res.data;
        stream.on('data', (chunk) => (downloadedBytes += chunk.length));
        const timeout = setTimeout(() => {
          stream.destroy();
          resolve(speedOf(Date.now() - startTime));
        }, config.playSpeedTest.duration);
        stream.on('end', () => {
          clearTimeout(timeout);
          resolve(speedOf(Date.now() - startTime));
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
  return withProxyFallback(doSpeedTest, '测速');
}

// ==================== 完整检测一个源 ====================

// 收尾结果：写入总耗时并合并覆盖字段（成败路径共用），可选记录日志
function finishResult(result, overrides, logMsg, sourceName) {
  result.totalTime = Date.now() - result._tStart;
  Object.assign(result, overrides);
  if (logMsg) log(logMsg, sourceName);
  return result;
}

async function testSource(source) {
  const keywords = source.isAdult ? config.search.adultKeywords : config.search.keywords;
  const searchKeywords = Array.isArray(keywords) ? keywords.filter((k) => k) : [keywords].filter((k) => k);
  log(`开始测试`, source.name);

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
    usedProxy: null,
    errorDetail: null,
    totalTime: null,
    _tStart: Date.now(),
  };

  // ---- 阶段 1：多关键词搜索 ----
  const searchResult = await checkSearch(source.api, searchKeywords, source.name);
  result.searchDuration = searchResult.duration;
  result.usedKeyword = searchResult.keyword;
  if (searchResult.status !== SEARCH_STATUS.SUCCESS) {
    const msg = `所有关键词搜索均失败 (关键词: ${searchKeywords.join(', ')})`;
    return finishResult(
      result,
      { status: SOURCE_STATUS.SEARCH_FAILED, errorDetail: msg },
      `搜索失败: ${msg}`,
      source.name
    );
  }
  log(`搜索成功: "${searchResult.keyword}" → ${searchResult.firstVideo?.vod_name || '?'}`, source.name);

  // ---- 阶段 2：获取详情 ----
  const detailResult = await getPlayInfo(source.api, searchResult.firstVideo.vod_id);
  if (!detailResult.success) {
    return finishResult(
      result,
      { status: SOURCE_STATUS.DETAIL_FAILED, errorDetail: detailResult.reason },
      `详情失败: ${detailResult.reason}`,
      source.name
    );
  }
  log(`详情获取成功: ${detailResult.video.vod_name}`, source.name);

  // ---- 阶段 3：解析 M3U8 URL ----
  const episodes = extractM3U8Url(detailResult.video.vod_play_url, detailResult.video.vod_play_from);
  if (!episodes) {
    const msg = '从 vod_play_url 中未解析出有效 HTTP 链接';
    return finishResult(
      result,
      { status: SOURCE_STATUS.PARSE_FAILED, errorDetail: msg },
      `解析失败: ${msg}`,
      source.name
    );
  }
  log(`解析到 ${episodes.length} 个播放链接`, source.name);

  // ---- 阶段 4：验证 M3U8 并获取分片 ----
  const m3u8Segment = await verifyM3U8AndGetSegment(episodes[0].url);
  if (!m3u8Segment.success || !m3u8Segment.segmentUrl) {
    return finishResult(
      result,
      { status: SOURCE_STATUS.M3U8_INVALID, errorDetail: m3u8Segment.reason, usedProxy: m3u8Segment.usedProxy ?? null },
      `M3U8 验证失败: ${m3u8Segment.reason}`,
      source.name
    );
  }
  log(`M3U8 验证通过`, source.name);
  if (m3u8Segment.hasEncryption) log(`(M3U8 有 AES-128 加密标记)`, source.name);

  // ---- 阶段 5：验证分片内容 ----
  const m3u8Info = { hasEncryption: m3u8Segment.hasEncryption };
  const segResult = await verifySegment(m3u8Segment.segmentUrl, m3u8Info);
  result.segmentType = segResult.segType;
  if (!segResult.success) {
    return finishResult(
      result,
      {
        status: SOURCE_STATUS.SEGMENT_INVALID,
        errorDetail: `分片内容无效: ${segResult.segType}`,
        usedProxy: segResult.usedProxy ?? null,
      },
      `分片无效: ${segResult.segType}`,
      source.name
    );
  }
  log(`分片内容验证通过: ${segResult.segType}`, source.name);

  // ---- 阶段 6：测速 ----
  let speedResult = null;
  if (config.playSpeedTest.enable) {
    speedResult = await testSegmentSpeed(m3u8Segment.segmentUrl);
    result.speedBytesPerSec = speedResult.speedBytesPerSec;
    log(
      speedResult.success
        ? `测速完成: ${(speedResult.speedBytesPerSec / 1024).toFixed(1)} KB/s`
        : `测速失败: ${speedResult.error}`,
      source.name
    );
  }
  // 任一步骤（M3U8 / 分片 / 测速）走过代理即记为 true
  result.usedProxy = speedResult?.usedProxy || segResult.usedProxy || m3u8Segment.usedProxy || false;

  return finishResult(result, { status: SOURCE_STATUS.AVAILABLE });
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
    const availTimes = withTime
      .filter((r) => r.status === SOURCE_STATUS.AVAILABLE)
      .map((r) => r.totalTime);
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

function saveResults(results, duration, startDate) {
  const compatibleResults = results.map((r) => ({
    id: r.id,
    name: r.name,
    api: r.api,
    detail: r.detail,
    isAdult: r.isAdult,
    status: r.status,
    search: { duration: r.searchDuration || null, usedKeyword: r.usedKeyword },
    play: { avgSpeed: r.speedBytesPerSec || null, segmentType: r.segmentType, usedProxy: r.usedProxy ?? null },
    errorDetail: r.errorDetail,
  }));

  const data = {
    startDate,
    endDate: fmtDate(),
    playSpeedTestEnabled: config.playSpeedTest.enable,
    keywords: { normal: config.search.keywords, adult: config.search.adultKeywords },
    // 不写入代理地址，避免提交到公开仓库泄露
    useProxy: { search: config.proxy.search, play: config.proxy.play },
    duration: `${duration}s`,
    stats: { total: results.length, available: results.filter((r) => r.status === SOURCE_STATUS.AVAILABLE).length },
    results: compatibleResults,
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

  const startDate = fmtDate();
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
      const speedInfo =
        r.status === SOURCE_STATUS.AVAILABLE && r.speedBytesPerSec
          ? ` ${(r.speedBytesPerSec / 1024).toFixed(0)}KB/s`
          : '';
      process.stdout.write(
        `[${bar}] ${pct}% (${completedCount}/${totalCount}) ${r.status === SOURCE_STATUS.AVAILABLE ? '✓' : '✗'} ${r.name}${speedInfo}`
      );
      return r;
    }),
    concurrent
  );

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  displayResults(results);
  saveResults(results, duration, startDate);
  saveLog();
  console.log(`\n[完成] 耗时 ${duration}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
