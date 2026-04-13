const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, '..', 'tv_source', 'LunaTV', 'LunaTV-config.json');
const outputFile = path.join(__dirname, '..', 'tv_source', 'LunaTV', 'LunaTV-processed.json');

function isAdultContent(name) {
  return name.includes('🔞');
}

function cleanName(name) {
  return name
    .replace(/🔞/g, '')
    .replace(/🎬/g, '')
    .trim()
    .replace(/^-+|-+$/g, '')
    .trim();
}

function cleanApiUrl(url) {
  const proxyPattern = /^https?:\/\/[^\/]+\/\?url=/;
  if (proxyPattern.test(url)) {
    return url.replace(proxyPattern, '');
  }
  return url;
}

function processConfig(config) {
  const result = {
    cache_time: config.cache_time,
    api_site: {},
  };

  for (const [key, value] of Object.entries(config.api_site)) {
    const originalName = value.name;
    const isAdult = isAdultContent(originalName);
    const cleanedName = cleanName(originalName);
    const cleanedApi = cleanApiUrl(value.api);
    const domainId = key.replace(/\./g, '-');

    result.api_site[key] = {
      ...value,
      id: domainId,
      name: cleanedName,
      api: cleanedApi,
      isAdult: isAdult,
    };
  }

  return result;
}

(async () => {
  try {
    if (!fs.existsSync(inputFile)) {
      console.error(`错误: 找不到输入文件: ${inputFile}`);
      process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
    const processed = processConfig(config);

    fs.writeFileSync(outputFile, JSON.stringify(processed, null, 2), 'utf8');

    const adultCount = Object.values(processed.api_site).filter((site) => site.isAdult).length;
    const normalCount = Object.values(processed.api_site).filter((site) => !site.isAdult).length;

    console.log(`✓ 已生成: ${outputFile}`);
    console.log(`  - 总视频源数: ${Object.keys(processed.api_site).length}`);
    console.log(`  - 正常资源: ${normalCount}`);
    console.log(`  - 成人资源: ${adultCount}`);
  } catch (error) {
    console.error(`\n错误: ${error.message}`);
    process.exit(1);
  }
})();
