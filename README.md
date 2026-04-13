# OuonnkiTV Source

将 MoonTV/LunaTV 视频源配置转换为 [OuonnkiTV](https://github.com/Ouonnki/OuonnkiTV) 视频源配置。

## 配置文件

| 文件名称          | 描述                                                             | 原始链接                                                                                                                   | 加速链接 1                                                                                                                                        | 加速链接 2                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| lite.json         | 轻量版：筛选后的视频源（不含成人内容，按响应速度排序取前 15 个） | [原始链接](https://raw.githubusercontent.com/ZhuBaiwan-oOZZXX/OuonnkiTV-Source/main/tv_source/OuonnkiTV/lite.json)         | [加速链接 1](https://gh-proxy.org/https://raw.githubusercontent.com/ZhuBaiwan-oOZZXX/OuonnkiTV-Source/main/tv_source/OuonnkiTV/lite.json)         | [加速链接 2](https://ghfast.top/https://raw.githubusercontent.com/ZhuBaiwan-oOZZXX/OuonnkiTV-Source/main/tv_source/OuonnkiTV/lite.json)         |
| full-noadult.json | 完整纯净版：筛选后的视频源（不含成人内容）                       | [原始链接](https://raw.githubusercontent.com/ZhuBaiwan-oOZZXX/OuonnkiTV-Source/main/tv_source/OuonnkiTV/full-noadult.json) | [加速链接 1](https://gh-proxy.org/https://raw.githubusercontent.com/ZhuBaiwan-oOZZXX/OuonnkiTV-Source/main/tv_source/OuonnkiTV/full-noadult.json) | [加速链接 2](https://ghfast.top/https://raw.githubusercontent.com/ZhuBaiwan-oOZZXX/OuonnkiTV-Source/main/tv_source/OuonnkiTV/full-noadult.json) |
| full.json         | 完整版：筛选后的视频源（包含成人内容）                           | [原始链接](https://raw.githubusercontent.com/ZhuBaiwan-oOZZXX/OuonnkiTV-Source/main/tv_source/OuonnkiTV/full.json)         | [加速链接 1](https://gh-proxy.org/https://raw.githubusercontent.com/ZhuBaiwan-oOZZXX/OuonnkiTV-Source/main/tv_source/OuonnkiTV/full.json)         | [加速链接 2](https://ghfast.top/https://raw.githubusercontent.com/ZhuBaiwan-oOZZXX/OuonnkiTV-Source/main/tv_source/OuonnkiTV/full.json)         |
| adult.json        | 成人版：仅成人内容视频源                                         | [原始链接](https://raw.githubusercontent.com/ZhuBaiwan-oOZZXX/OuonnkiTV-Source/main/tv_source/OuonnkiTV/adult.json)        | [加速链接 1](https://gh-proxy.org/https://raw.githubusercontent.com/ZhuBaiwan-oOZZXX/OuonnkiTV-Source/main/tv_source/OuonnkiTV/adult.json)        | [加速链接 2](https://ghfast.top/https://raw.githubusercontent.com/ZhuBaiwan-oOZZXX/OuonnkiTV-Source/main/tv_source/OuonnkiTV/adult.json)        |

## 本地运行

### 一键启动

```bash
node start.js
```

一键执行所有处理步骤：下载 → 处理 → 检测 → 转换。

### 分步运行

分步运行需要按照以下顺序执行每个脚本：

| 脚本                         | 功能                  | 输出                                                |
| ---------------------------- | --------------------- | --------------------------------------------------- |
| 01_download_lunatv_config.js | 下载 LunaTV 原始配置  | LunaTV-config.json                                  |
| 02_process_lunatv_config.js  | 清理配置数据          | LunaTV-processed.json                               |
| 03_check_video_sources.js    | 检测源可用性          | LunaTV-check-result.json                            |
| 04_convert_ouonnkitv.js      | 转换为 OuonnkiTV 格式 | full.json, full-noadult.json, lite.json, adult.json |

### 配置说明

编辑 `config.js` 可自定义以下配置：

```javascript
module.exports = {
  skipSslVerification: false,  // 是否跳过 SSL 证书验证
  logToFile: true,             // 是否记录详细日志到文件

  proxy: {
    url: "",        // 代理 URL，留空不启用
    download: true, // 下载视频源时使用代理
    check: true,    // 搜索检测时使用代理
    play: false,    // 播放测速时使用代理
  },

  check: {
    timeout: 5000,        // 请求超时时间（毫秒）
    concurrent: 20,       // 搜索并发数
    maxRetry: 2,          // 失败重试次数
    retryDelay: 1000,     // 重试间隔（毫秒）
    keyword: "斗罗大陆",   // 搜索关键词（正常视频源）
    adultKeyword: "三上悠", // 搜索关键词（成人视频源），留空则使用 keyword
    headers: { ... },     // HTTP 请求头
  },

  playSpeedTest: {
    enable: true,       // 是否启用播放测速（false 时仅搜索检测）
    episodeCount: 3,    // 每个视频源测试的最大集数
    duration: 5000,     // 每次测速持续时间（毫秒）
    concurrent: 3,      // 测速并发数
  },
};
```

代理 URL 填写后将按照 `https://{proxy.url}/原始URL` 进行请求，请注意代理 URL 满足此用法，留空表示不启用。

## 自动更新

GitHub Actions 每天北京时间早上 6 点自动执行 `start.js` 并推送更新至仓库。

## 感谢

- **[LunaTV-config](https://github.com/hafrey1/LunaTV-config)** - 提供每日自动检测和更新的高质量视频源配置
- **[OuonnkiTV](https://github.com/Ouonnki/OuonnkiTV)** - 优秀的视频搜索与播放前端，支持自定义视频源

---

<details>
<summary>免责声明（Copy from LunaTV-config）</summary>

# 免责声明

> **在使用本仓库前，请务必仔细阅读本声明。**
>
> 任何以任何形式访问、使用、复制、修改或分发本仓库内容的行为，均视为已阅读并同意本免责声明的全部条款。

---

## 一、定义与范围

- **本仓库**：指本 GitHub 仓库及其直接或间接相关的其他仓库。
- **维护者**：指本仓库的管理员、维护者及任何参与内容整理与分享的人员。
- **仓库内容**：指本仓库中提供的全部配置文件、源定义、代码片段、文档说明及引用的外部资源信息。

---

## 二、仓库用途说明（MoonTV / LunaTV 源配置）

1. 本仓库主要提供 **MoonTV / LunaTV 等相关项目的源配置、订阅定义或配置示例**，内容均整理自互联网公开信息。
2. 本仓库内容 **仅用于学习、测试与技术研究目的**，包括但不限于配置格式研究、源聚合方式分析及客户端兼容性测试。
3. **本仓库不存储、不托管、不分发任何音视频文件、媒体流或受版权保护的内容**，亦不提供任何形式的媒体服务。
4. 除非另有明确书面声明，本仓库 **不授予任何商业使用许可**。
5. 严禁将本仓库内容用于任何违反法律法规、版权规则或所在司法辖区政策的用途。

---

## 三、无任何担保声明

本仓库及其内容均以 **“现状（AS IS）”** 方式提供，维护者不作出任何形式的明示或暗示担保，包括但不限于：

- 合法性
- 准确性
- 完整性
- 可用性
- 适用于特定目的

使用本仓库内容所产生的一切风险均由使用者自行承担。

---

## 四、责任限制

1. 因使用、误用、修改或分发本仓库内容而导致的任何直接或间接损失，包括但不限于数据丢失、系统故障、服务中断、法律风险等，维护者概不负责。
2. 用户在使用本仓库内容过程中，如违反其所在国家或地区的法律法规，所产生的一切法律责任均由用户自行承担，与本仓库及维护者无关。

---

## 五、第三方软件与项目声明

1. MoonTV、LunaTV 及任何在本仓库中提及的第三方软件、硬件、服务或项目，均 **与本仓库不存在任何隶属、合作、授权或背书关系**。
2. 本仓库不对任何第三方软件或服务的功能、合法性或可用性作出保证。
3. 因使用第三方软件或服务所产生的一切后果，均由使用者自行承担。

---

## 六、转载与分发限制

1. 未经维护者明确授权，**禁止以任何形式在其他平台、网站、公众号、自媒体或镜像站点转载、发布或再分发本仓库内容**。
2. 允许在 GitHub 平台内出于学习和研究目的进行 fork，但须保留本免责声明且不得改变仓库性质或用途。
3. 通过正常开发工具获取的域名、地址或配置信息，且未涉及逆向工程或网络攻击行为的，不构成对计算机系统的非法侵入。

---

## 七、知识产权与侵权处理

1. 若任何单位或个人认为本仓库内容可能侵犯其合法权益，请及时联系维护者，并提供有效的身份证明及权属证明材料。
2. 在核实相关材料后，维护者将依法依规尽快删除或处理相关内容。

---

## 八、使用期限与删除建议

1. 本仓库内容仅供 **临时学习与研究参考**。
2. 任何关于使用时限（如 24 小时）的表述，均属于风险提示性质，并非强制性法律义务（法律另有规定的除外）。
3. 建议用户在完成学习或研究后，及时删除本仓库内容的本地副本。
4. 如对相关功能存在长期或生产环境需求，请自行独立开发实现。

---

## 九、司法辖区提示

1. 本仓库内容 **不建议在中国大陆地区使用**，尤其是在相关应用或配置可能违反当地法律法规的情形下。
2. 用户应自行评估并承担因使用本仓库内容所带来的合规与法律风险。

---

## 十、免责声明的修改与接受

1. 维护者保留在不另行通知的情况下，随时修改或补充本免责声明的权利。
2. 任何对本仓库内容的访问、使用、复制、修改或分发行为，均视为已充分阅读并接受本免责声明的全部内容。

**若您不同意本免责声明中的任何条款，请立即停止使用并删除本仓库的全部内容。**

</details>
