/**
 * 代理辅助模块
 *
 * 各功能在 config 中拥有独立的 proxyMode 字段（取值见 config.js 的 proxyUrl 注释），
 * 本模块负责把策略翻译成实际的请求行为。
 */

const config = require('./config.js');

// 按 useProxy 拼出最终请求地址：走代理时拼接为 {proxyUrl}/{原始URL}
function applyProxy(url, useProxy) {
  return useProxy && config.proxyUrl ? `${config.proxyUrl}/${url}` : url;
}

// 生成尝试序列（useProxy 布尔数组，按顺序尝试，命中即止）
// 代理地址为空时一律只直连，proxyMode 不生效
function proxyAttempts(mode, { directRetries = 1 } = {}) {
  if (!config.proxyUrl) return [false];
  if (mode === 'proxy') return [true];
  if (mode === 'fallback') return [...Array(directRetries + 1).fill(false), true];
  return [false];
}

// 通用封装：按 proxyMode 依次尝试 requestFn(useProxy)，成功即返回 { result, usedProxy }；
// 全部失败时抛出最后一个错误（错误上附带 usedProxy = 最后一次尝试是否走了代理）。
// opts:
//   directRetries - 透传给 proxyAttempts
//   onFail(err, useProxy, nextUseProxy) - 每次尝试失败的回调（nextUseProxy 为下一次是否走代理，最后一次为 undefined）
async function tryWithProxy(mode, requestFn, opts = {}) {
  const attempts = proxyAttempts(mode, opts);
  let lastErr;
  for (let i = 0; i < attempts.length; i++) {
    const useProxy = attempts[i];
    try {
      return { result: await requestFn(useProxy), usedProxy: useProxy };
    } catch (err) {
      lastErr = err;
      lastErr.usedProxy = useProxy;
      // 标记 noRetry 的错误（响应正常但内容缺失等非网络问题）不换代理重复请求，也不记失败日志
      if (err.noRetry) break;
      if (opts.onFail) opts.onFail(err, useProxy, attempts[i + 1]);
    }
  }
  throw lastErr;
}

module.exports = { applyProxy, tryWithProxy };
