<p align="center"><img src="icons/icon-128.png" width="96" alt="X Oldest"></p>

# X Oldest

**English** · [简体中文](README.zh-CN.md)

A Chrome extension that adds an **Oldest** tab to X profile pages, so you can read a user's posts from the earliest to the latest, in a view that matches X's own look.

Unofficial. Not affiliated with X Corp.

## Install

1. Download `x-oldest-<version>.zip` from the [latest release](https://github.com/realOzine/x-oldest/releases/latest) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.
4. Open any profile on x.com while signed in, then click the **Oldest** tab.

Requires Chrome 111 or later.

## Development

Requires Node.js 18 or later.

- `npm install && npm run build` builds into `dist/`. Load the repository folder itself as an unpacked extension.
- `npm run watch` rebuilds on every change. After a rebuild, reload the extension in `chrome://extensions`, then reload the x.com page.
- `npm run release` builds, then writes the loadable extension to `release/x-oldest/` and zips it as `release/x-oldest-<version>.zip`.

To publish a release, run `npm version patch` (or `minor`, `major`), then `git push --follow-tags`. `npm version` bumps `package.json` and `manifest.json` together, commits, and tags; GitHub Actions then builds the zip and attaches it to a new release.

## Project structure

```
manifest.json          Extension manifest (MV3, no permissions)
package.json           Build scripts (esbuild)
dist/                  Build output: engine.js and ui.js (not committed)
release/               Packaged extension and its zip (not committed)
src/engine/            Data engine, bundled into dist/engine.js
  main.js                Entry point
  errors.js              XoError, an error with a kind
  transport.js           Requests to X, using context borrowed from the page
  normalize.js           X's response objects -> plain post and user objects
  reader.js              Walks history forward, window by window
  api.js                 resolveUser and openReader, for the UI
src/store.js           Local cache (IndexedDB)
src/ui/                Reading view, bundled into dist/ui.js
  main.js                Entry point
  i18n.js                Strings and date formats (English, Chinese)
  cards.js               Renders one post
  page.js                Reads X's page: profile detection, theme, tab
  view.js                Toolbar, card list, status line, clicks
  app.js                 Sessions, loading loop, cache, route tracking
  ui.css                 Styles
icons/                 Extension icons
scripts/make-icons.mjs Regenerates the icons
scripts/release.mjs    Packages the extension
scripts/sync-version.mjs Copies the version into manifest.json
docs/architecture.md   Architecture notes (Chinese)
docs/spce.md           Original spec (Chinese)
```

## How it works

- X's timeline only goes back a limited number of posts, so the extension uses X's search with a time range instead.
- The source is plain ES modules, bundled by esbuild into two scripts.
- It runs inside the x.com page and reuses your existing session. Request headers, feature flags, query IDs and request signatures are all taken from X's own runtime; nothing is hard-coded.
- Search returns newest first. The reader walks forward window by window, collects each window completely, then shows it in ascending order.
- Loaded posts and reading position are cached locally in IndexedDB. No data leaves your browser, and no credentials are stored.

See [docs/architecture.md](docs/architecture.md) for details.

## Limitations

- "Oldest" means the earliest post X's search returns, which may not be the account's true first post.
- X limits search to about 50 requests per 15 minutes; the extension waits and continues automatically.
- It relies on X's internal web interfaces and may break when X changes them.

## License

[MIT](LICENSE)
