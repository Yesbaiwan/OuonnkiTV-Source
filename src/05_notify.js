/**
 * 发送检测结果通知（Telegram）
 *
 * 读取 LunaTV-check-result.json 的检测统计和 OuonnkiTV 各版本源数量，
 * 通过 Telegram Bot API sendRichMessage 发送每日检测报告（富文本消息，原生表格）。
 * 凭据从环境变量 TG_BOT_TOKEN / TG_CHAT_ID 读取（src/.env），
 * 未配置时自动跳过；代理策略由 config.telegram.proxyMode 决定（默认 'fallback'：先直连，失败回退代理）；
 * 发送失败不阻塞数据更新主流程。
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config.js');
const { applyProxy, tryWithProxy } = require('./proxy.js');

const checkResultFile = path.join(
  __dirname,
  '..',
  'tv_source',
  'LunaTV',
  'LunaTV-check-result.json',
);
const outputDir = path.join(__dirname, '..', 'tv_source', 'OuonnkiTV');

// 各版本输出文件（与 04_convert_ouonnkitv.js 的产出对应）
const VERSIONS = ['raw.json', 'full.json', 'full-noadult.json', 'adult.json', 'lite.json'];

function countRecords(filename) {
  const file = path.join(outputDir, filename);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')).length;
}

// 富文本消息用 GFM markdown 描述；本消息只有固定文件名、数字和日期，无特殊字符需要转义
function buildMessage(check) {
  const mode = check.playSpeedTestEnabled ? '搜索 + 测速' : '仅搜索';
  const stats = check.stats || {};
  const total = stats.total ?? '-';
  const available = stats.available ?? '-';
  const failed = total === '-' ? '-' : total - available;

  // 各版本数量行（表格只保留短名称，避免列太宽）
  const table = [
    '| 版本 | 数量 |',
    '| :--- | :---: |',
    ...VERSIONS.map((file) => {
      const count = countRecords(file);
      return `| ${file.replace(/\.json$/, '')} | ${count == null ? '未生成' : count} |`;
    }),
  ].join('\n');

  return [
    '## OuonnkiTV 源检测报告',
    '',
    `**可用 ${available} / ${total}（失败 ${failed}）**`,
    '',
    `**模式**：${mode}`,
    '',
    `**任务开始**：${check.startDate || '未知'}  \\`,
    `**任务完成**：${check.endDate || '未知'}`,
    '',
    '## 各版本源数量：',
    '',
    table,
  ].join('\n');
}

// 发送一条 Telegram 富文本消息（按 telegram.proxyMode 依次尝试，代理未配置则只直连）
async function sendTelegram(markdown) {
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendRichMessage`;
  const payload = {
    chat_id: config.telegram.chatId,
    rich_message: { markdown },
  };

  // 直连只试 1 次即回退（directRetries: 0）；超时统一用 config.http.timeout
  await tryWithProxy(
    config.telegram.proxyMode,
    (useProxy) => axios.post(applyProxy(url, useProxy), payload, { timeout: config.http.timeout }),
    { directRetries: 0 },
  );
}

(async () => {
  try {
    const { enable, botToken, chatId } = config.telegram;
    if (!enable || !botToken || !chatId) {
      if (!enable) console.log('[通知] 通知功能已关闭，跳过');
      else console.log('[通知] 未配置 TG_BOT_TOKEN / TG_CHAT_ID，跳过通知');
      return;
    }
    if (!fs.existsSync(checkResultFile)) {
      console.error(`[通知] 错误: 找不到检测结果文件: ${checkResultFile}`);
      process.exit(1);
    }

    const check = JSON.parse(fs.readFileSync(checkResultFile, 'utf8'));
    const text = buildMessage(check);
    await sendTelegram(text);
    console.log('\n[通知] 已发送');
  } catch (error) {
    // 通知失败不阻塞数据更新主流程
    console.error(`\n[通知] 发送失败: ${error.message}`);
  }
})();
