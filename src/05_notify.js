/**
 * 发送检测结果通知（Telegram）
 *
 * 读取 LunaTV-check-result.json 的检测统计和 OuonnkiTV 各版本源数量，
 * 通过 Telegram Bot API 发送每日检测报告。
 * 凭据从环境变量 TG_BOT_TOKEN / TG_CHAT_ID 读取（src/.env），
 * 未配置时自动跳过；直连失败自动回退 proxy.url 前缀代理；发送失败不阻塞数据更新主流程。
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config.js');

const checkResultFile = path.join(__dirname, '..', 'tv_source', 'LunaTV', 'LunaTV-check-result.json');
const outputDir = path.join(__dirname, '..', 'tv_source', 'OuonnkiTV');

// 各版本输出文件（与 04_convert_ouonnkitv.js 的产出对应）
const VERSIONS = ['raw.json', 'full.json', 'full-noadult.json', 'adult.json', 'lite.json'];

function countRecords(filename) {
  const file = path.join(outputDir, filename);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')).length;
}

function buildMessage(check) {
  const mode = check.playSpeedTestEnabled ? '搜索+测速' : '仅搜索';
  const stats = check.stats || {};
  const total = stats.total ?? '-';
  const available = stats.available ?? '-';
  const failed = total === '-' ? '-' : total - available;

  const lines = [
    'OuonnkiTV 源检测报告',
    `任务开始: ${check.startDate || '未知'}`,
    `任务完成: ${check.endDate || '未知'}`,
    `模式: ${mode}`,
    `结果: 总数 ${total} | 可用 ${available} | 失败 ${failed}`,
    '',
    '各版本源数量:',
  ];

  for (const file of VERSIONS) {
    const count = countRecords(file);
    lines.push(`- ${file}: ${count == null ? '未生成' : `${count} 个`}`);
  }

  return lines.join('\n');
}

// 发送一条 Telegram 消息
async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
  const payload = { chat_id: config.telegram.chatId, text };

  try {
    await axios.post(url, payload, { timeout: 5000 });
  } catch (err) {
    // 直连失败时回退 proxy.url 前缀代理
    if (!config.proxy.url) throw err;
    await axios.post(`${config.proxy.url}/${url}`, payload, { timeout: 15000 });
  }
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
    console.log('\n[通知] 发送内容:\n' + text);
    await sendTelegram(text);
    console.log('\n[通知] 已通知');
  } catch (error) {
    // 通知失败不阻塞数据更新主流程
    console.error(`\n[通知] 发送失败: ${error.message}`);
  }
})();
