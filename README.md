<p align="center"><img src="icons/icon-128.png" width="96" alt="X Oldest"></p>

# X Oldest

[English](#english) · [中文](#中文)

## English

A Chrome extension that adds an **Oldest** tab to X profile pages, so you can read a user's posts from the earliest to the latest, in a view that matches X's own look.

Unofficial. Not affiliated with X Corp.

### Install

1. Clone or download this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repository folder.
4. Open any profile on x.com while signed in, then click the **Oldest** tab.

Requires Chrome 111 or later.

### Project structure

```
manifest.json          Extension manifest (MV3, no permissions)
src/engine.js          Data engine: requests, normalisation, forward reader
src/store.js           Local cache (IndexedDB)
src/ui.js              Profile integration and post cards
src/ui.css             Styles
icons/                 Extension icons
scripts/make-icons.mjs Regenerates the icons
docs/architecture.md   Architecture notes (Chinese)
docs/spce.md           Original spec (Chinese)
```

### How it works

- X's timeline only goes back a limited number of posts, so the extension uses X's search with a time range instead.
- It runs inside the x.com page and reuses your existing session. Request headers, feature flags, query IDs and request signatures are all taken from X's own runtime; nothing is hard-coded.
- Search returns newest first. The reader walks forward window by window, collects each window completely, then shows it in ascending order.
- Loaded posts and reading position are cached locally in IndexedDB. No data leaves your browser, and no credentials are stored.

See [docs/architecture.md](docs/architecture.md) for details.

### Limitations

- "Oldest" means the earliest post X's search returns, which may not be the account's true first post.
- X limits search to about 50 requests per 15 minutes; the extension waits and continues automatically.
- It relies on X's internal web interfaces and may break when X changes them.

### License

[MIT](LICENSE)

## 中文

一个 Chrome 插件：在 X 用户主页增加「最早」标签，按从旧到新的顺序阅读该用户的历史帖子，界面与 X 原生样式保持一致。

非官方项目，与 X Corp. 无关。

### 安装

1. 克隆或下载本仓库。
2. 打开 `chrome://extensions`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择仓库目录。
4. 在已登录的 x.com 打开任意用户主页，点击「最早」标签。

需要 Chrome 111 或更高版本。

### 项目结构

```
manifest.json          扩展清单（MV3，不申请任何权限）
src/engine.js          数据引擎：请求、数据整理、向前推进的读取器
src/store.js           本地缓存（IndexedDB）
src/ui.js              主页集成与帖子卡片
src/ui.css             样式
icons/                 扩展图标
scripts/make-icons.mjs 重新生成图标
docs/architecture.md   架构说明
docs/spce.md           原始需求文档
```

### 实现方式

- X 的时间线只能回溯有限数量的帖子，所以插件改用带时间范围的搜索。
- 代码运行在 x.com 页面内，复用你已有的登录状态。请求头、功能开关、查询 ID 和请求签名都取自 X 自己的运行时，没有写死任何值。
- 搜索只能从新到旧返回。读取器按时间窗口向前推进，把每个窗口取完整后再按升序显示。
- 已加载的帖子和阅读位置缓存在本地 IndexedDB。数据不离开浏览器，也不保存任何登录凭证。

详见 [docs/architecture.md](docs/architecture.md)。

### 已知限制

- 「最早」指 X 搜索能返回的最早帖子，不一定是该账号真正的第一条。
- X 的搜索限制约为每 15 分钟 50 次；达到上限后插件会等待并自动继续。
- 依赖 X 的内部网页接口，X 改版后可能失效。

### 开源协议

[MIT](LICENSE)
