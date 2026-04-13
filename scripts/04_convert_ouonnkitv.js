const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, '..', 'tv_source', 'LunaTV', 'LunaTV-check-result.json');
const outputDir = path.join(__dirname, '..', 'tv_source', 'OuonnkiTV');
const LITE_LIMIT = 15;

function convertRecord(r) {
  return { id: r.id, name: r.name, url: r.api, detailUrl: r.detail || r.api, isEnabled: true };
}

function saveJson(filename, records) {
  const data = records.map(convertRecord);
  fs.writeFileSync(path.join(outputDir, filename), JSON.stringify(data, null, 2), 'utf8');
  return data.length;
}

function getQualified(results) {
  return results.filter((r) => r.status === 'available');
}

function getTopFastest(records, limit) {
  return [...records]
    .sort((a, b) =>
      a.play.avgSpeed != null
        ? b.play.avgSpeed - a.play.avgSpeed
        : (a.search.duration || Infinity) - (b.search.duration || Infinity)
    )
    .slice(0, limit);
}

(async () => {
  try {
    if (!fs.existsSync(inputFile)) {
      console.error(`错误: 找不到输入文件: ${inputFile}`);
      process.exit(1);
    }
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const inputData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    const playSpeedTestEnabled = inputData.playSpeedTestEnabled || false;
    console.log(`模式: ${playSpeedTestEnabled ? '搜索+测速' : '仅搜索'}`);

    const qualified = getQualified(inputData.results);
    const nonAdult = qualified.filter((x) => !x.isAdult);
    const adult = qualified.filter((x) => x.isAdult);
    const topFastest = getTopFastest(nonAdult, LITE_LIMIT);

    const outputs = [
      { name: 'full.json', data: qualified },
      { name: 'full-noadult.json', data: nonAdult },
      { name: 'lite.json', data: topFastest },
      { name: 'adult.json', data: adult },
    ];

    for (const { name, data } of outputs) {
      const count = saveJson(name, data);
      console.log(`✓ 已生成: ${name} (${count} 个视频源)`);
    }
  } catch (error) {
    console.error(`\n错误: ${error.message}`);
    process.exit(1);
  }
})();
