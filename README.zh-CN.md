<p align="center"><img src="icons/icon-128.png" width="96" alt="X Oldest"></p>

# X Oldest

[English](README.md) · **简体中文**

一个 Chrome 插件：在 X 用户主页增加「最早」标签，按从旧到新的顺序阅读该用户的历史帖子，界面与 X 原生样式保持一致。

非官方项目，与 X Corp. 无关。

## 安装

1. 克隆本仓库。
2. 构建：`npm install && npm run build`。
3. 打开 `chrome://extensions`，开启「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择仓库目录。
5. 在已登录的 x.com 打开任意用户主页，点击「最早」标签。

需要 Chrome 111 或更高版本；构建需要 Node.js 18 或更高版本。

## 开发

`npm run watch` 会在每次改动后自动重新构建。构建后先在 `chrome://extensions` 重新加载插件，再刷新 x.com 页面。

## 项目结构

```
manifest.json          扩展清单（MV3，不申请任何权限）
package.json           构建脚本（esbuild）
dist/                  构建产物：engine.js 和 ui.js（不进版本库）
src/engine/            数据引擎，打包为 dist/engine.js
  main.js                入口
  errors.js              XoError，带种类的错误
  transport.js           向 X 发请求，请求上下文借自页面
  normalize.js           把 X 的返回整理成统一的帖子、用户对象
  reader.js              按时间窗口向前读取历史
  api.js                 给界面用的 resolveUser 和 openReader
src/store.js           本地缓存（IndexedDB）
src/ui/                阅读界面，打包为 dist/ui.js
  main.js                入口
  i18n.js                文案与日期格式（中文、英文）
  cards.js               渲染一条帖子
  page.js                读 X 的页面：识别主页、主题、标签
  view.js                工具栏、卡片列表、状态栏、点击处理
  app.js                 会话、加载循环、缓存、跟随路由
  ui.css                 样式
icons/                 扩展图标
scripts/make-icons.mjs 重新生成图标
docs/architecture.md   架构说明
docs/spce.md           原始需求文档
```

## 实现方式

- X 的时间线只能回溯有限数量的帖子，所以插件改用带时间范围的搜索。
- 源码是普通的 ES 模块，由 esbuild 打包成两个脚本。
- 代码运行在 x.com 页面内，复用你已有的登录状态。请求头、功能开关、查询 ID 和请求签名都取自 X 自己的运行时，没有写死任何值。
- 搜索只能从新到旧返回。读取器按时间窗口向前推进，把每个窗口取完整后再按升序显示。
- 已加载的帖子和阅读位置缓存在本地 IndexedDB。数据不离开浏览器，也不保存任何登录凭证。

详见 [docs/architecture.md](docs/architecture.md)。

## 已知限制

- 「最早」指 X 搜索能返回的最早帖子，不一定是该账号真正的第一条。
- X 的搜索限制约为每 15 分钟 50 次；达到上限后插件会等待并自动继续。
- 依赖 X 的内部网页接口，X 改版后可能失效。

## 开源协议

[MIT](LICENSE)
