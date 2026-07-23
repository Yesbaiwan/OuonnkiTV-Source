# OuonnkiTV Source

English | [简体中文](README.md)

Convert MoonTV/LunaTV video source configuration to [OuonnkiTV](https://github.com/Ouonnki/OuonnkiTV) video source configuration.

> [!NOTE]
> This document is AI-translated from the [Chinese version](README.md).

## Configuration Files

| File Name         | Description                                                                       | Original Link                                                                                                       | Mirror Link 1                                                                                                                            | Mirror Link 2                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| lite.json         | Lite version: Filtered video sources (no adult content, top 15 by response speed) | [Original](https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/lite.json)         | [Mirror 1](https://gh-proxy.org/https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/lite.json)         | [Mirror 2](https://git.yylx.win/https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/lite.json)         |
| full-noadult.json | Full clean version: Filtered video sources (no adult content)                     | [Original](https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/full-noadult.json) | [Mirror 1](https://gh-proxy.org/https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/full-noadult.json) | [Mirror 2](https://git.yylx.win/https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/full-noadult.json) |
| full.json         | Full version: Filtered video sources (includes adult content)                     | [Original](https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/full.json)         | [Mirror 1](https://gh-proxy.org/https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/full.json)         | [Mirror 2](https://git.yylx.win/https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/full.json)         |
| adult.json        | Adult version: Adult content video sources only                                   | [Original](https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/adult.json)        | [Mirror 1](https://gh-proxy.org/https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/adult.json)        | [Mirror 2](https://git.yylx.win/https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/adult.json)        |
| raw.json          | Raw version: All sources converted without any filtering/detection                | [Original](https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/raw.json)         | [Mirror 1](https://gh-proxy.org/https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/raw.json)         | [Mirror 2](https://git.yylx.win/https://raw.githubusercontent.com/Yesbaiwan/OuonnkiTV-Source/main/tv_source/OuonnkiTV/raw.json)         |

## Running Locally

### One-Click Start

```bash
node start.js
```

Execute all processing steps in one go: Download → Process → Check → Convert.

### Step-by-Step Execution

Step-by-step execution requires running each script in the following order:

| Script                       | Function                        | Output                                              |
| ---------------------------- | ------------------------------- | --------------------------------------------------- |
| 01_download_lunatv_config.js | Download LunaTV original config | LunaTV-config.json                                  |
| 02_process_lunatv_config.js  | Clean configuration data        | LunaTV-processed.json                               |
| 03_check_video_sources.js    | Check source availability       | LunaTV-check-result.json                            |
| 04_convert_ouonnkitv.js      | Convert to OuonnkiTV format     | raw.json, full.json, full-noadult.json, lite.json, adult.json |

### Configuration Guide

Edit `src/config.js` to customize the following settings:

```javascript
module.exports = {
  // Global HTTP request config (shared by download, search, detail and speed test)
  http: {
    skipSslVerification: false, // Whether to skip SSL certificate verification
    timeout: 5000,              // Request timeout (milliseconds)
    headers: { ... },           // Common HTTP request headers
  },

  // Logging config
  log: {
    toFile: true,               // Whether to record detailed logs to file
  },

  // Proxy config
  proxy: {
    url: "",        // Proxy URL, leave empty to disable
    download: true, // Use proxy when downloading video sources
    search: true,   // Use proxy when searching/fetching details
    play: false,    // Use proxy when testing playback speed
  },

  // Search detection config
  search: {
    concurrent: 20,         // Concurrent search requests (search-only mode)
    maxRetry: 2,            // Number of retries on failure
    retryDelay: 1000,       // Retry interval (milliseconds)
    keyword: "斗罗大陆",     // Search keyword (normal video sources)
    adultKeyword: "三上悠",  // Search keyword (adult video sources), leave empty to use keyword
  },

  // Playback speed test config
  playSpeedTest: {
    enable: true,       // Whether to enable playback speed test (false means search check only)
    episodeCount: 3,    // Maximum number of episodes to test per video source
    duration: 5000,     // Duration of each speed test (milliseconds)
    concurrent: 3,      // Total concurrency in search + speed test mode (overrides search.concurrent when enable=true)
  },
};
```

> [!NOTE]
> **About the `PROXY_URL` Environment Variable**
>
> - `PROXY_URL` is the proxy address. Requests will be made as `{PROXY_URL}/{originalURL}`, e.g., `PROXY_URL=https://proxy.example.com`. Leave empty to disable proxying.
> - This repository's GitHub Actions has a built-in proxy address (Secrets), not available after forking.
> - **Local**: Set `PROXY_URL=https://proxy.example.com` in `src/.env`, or edit `proxy.url` in `src/config.js`.
> - **GitHub Actions**: Add `PROXY_URL` in Settings → Secrets and variables → Actions → Repository secrets.

## Automatic Updates

GitHub Actions automatically runs `start.js` and pushes updates to the repository at 22:00 UTC every day.

## Thanks

- **[LunaTV-config](https://github.com/hafrey1/LunaTV-config)** - Provides daily automatic detection and updates of high-quality video source configurations
- **[OuonnkiTV](https://github.com/Ouonnki/OuonnkiTV)** - Excellent video search and playback frontend with support for custom video sources
