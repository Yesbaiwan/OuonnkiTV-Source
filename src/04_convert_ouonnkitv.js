const fs = require('fs');
const path = require('path');
const Table = require('cli-table3');

const checkResultFile = path.join(__dirname, '..', 'tv_source', 'LunaTV', 'LunaTV-check-result.json');
const outputDir = path.join(__dirname, '..', 'tv_source', 'OuonnkiTV');
const LITE_LIMIT = 15;

function displayWidth(str) {
  let w = 0;
  for (const ch of str) w += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return w;
}

function toOutput(r) {
  return { id: r.id, name: r.name, url: r.api, detailUrl: r.detail || r.api, isEnabled: true };
}

function saveJson(filename, records) {
  const data = records.map(toOutput);
  fs.writeFileSync(path.join(outputDir, filename), JSON.stringify(data, null, 2), 'utf8');
  return data.length;
}

function bySpeed(a, b) {
  const aSpd = a.play.avgSpeed;
  const bSpd = b.play.avgSpeed;
  if (aSpd != null && bSpd != null) return bSpd - aSpd;
  if (aSpd != null) return -1;
  if (bSpd != null) return 1;
  return (a.search.duration || Infinity) - (b.search.duration || Infinity);
}

(async () => {
  try {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    if (!fs.existsSync(checkResultFile)) {
      console.error(`错误: 找不到检测结果文件: ${checkResultFile}`);
      process.exit(1);
    }

    const { results = [], playSpeedTestEnabled } = JSON.parse(fs.readFileSync(checkResultFile, 'utf8'));
    const mode = playSpeedTestEnabled ? '搜索+测速' : '仅搜索';
    console.log(`模式: ${mode}\n`);

    const available = results.filter((r) => r.status === 'available');
    const normal = available.filter((r) => !r.isAdult);

    const rows = [
      ['raw.json', saveJson('raw.json', results)],
      ['full.json', saveJson('full.json', available)],
      ['full-noadult.json', saveJson('full-noadult.json', normal)],
      ['adult.json', saveJson('adult.json', available.filter((r) => r.isAdult))],
      ['lite.json', saveJson('lite.json', [...normal].sort(bySpeed).slice(0, LITE_LIMIT))],
    ];

    const nameWidth = rows.reduce((m, [n]) => Math.max(m, displayWidth(n)), displayWidth('文件'));
    const countWidth = rows.reduce((m, [, c]) => Math.max(m, displayWidth(`${c} 个`)), displayWidth('数量'));
    // cli-table3 每列左右各有1字符内边距，colWidths 要包含这2个字符
    const colWidths = [nameWidth + 2, countWidth + 2];

    const table = new Table({
      head: ['文件', '数量'],
      style: { head: ['cyan'] },
      colWidths,
    });

    for (const [name, count] of rows) table.push([name, `${count} 个`]);
    console.log(table.toString());
  } catch (error) {
    console.error(`\n错误: ${error.message}`);
    process.exit(1);
  }
})();
