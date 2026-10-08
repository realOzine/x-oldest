// Profile-page integration: the "Oldest" tab and the oldest-to-newest reading view.
// Likes, replies and reposts are left to X's own post page; cards only link to it.
(() => {
  const E = window.__xoldest;
  if (!E || window.__xoldestUi) return;
  window.__xoldestUi = true;

  const DAY = 86400;
  // Follow X's own display language rather than the browser's.
  const lang = (document.documentElement.lang || navigator.language || 'en').toLowerCase();
  const zh = lang.startsWith('zh');
  const T = zh
    ? {
        tab: '最早',
        earliest: (d) => `目前找到的最早帖子：${d}`,
        fromDate: (d) => `从 ${d} 开始阅读，此前的时间段尚未查询`,
        withReplies: '包含回复',
        clearCache: '清除缓存',
        startFrom: '起始月份',
        resolving: '正在读取账号信息…',
        searching: (d) => `正在查找 ${d} 之后的帖子…`,
        rate: (t) => `已达到 X 的搜索频率限制，将在 ${t} 自动继续`,
        end: (d) => `已读到本次查询范围的末尾（截至 ${d}）`,
        none: '该查询范围内未找到可获取的帖子',
        incompatible: '与当前 X 页面不兼容，请刷新页面后重试',
        auth: '请先在 X 正常登录后再试',
        unavailable: '当前无法获取该账号的历史帖子',
        failed: '加载失败',
        retry: '重试',
        replyingTo: (n) => `回复 @${n}`,
        quoteMissing: '引用内容暂不可用',
        mediaMissing: '在原帖中查看媒体',
        stats: (c) => `回复 ${c.replies} · 转帖 ${c.reposts} · 喜欢 ${c.likes}`,
      }
    : {
        tab: 'Oldest',
        earliest: (d) => `Earliest post found so far: ${d}`,
        fromDate: (d) => `Reading from ${d}; earlier periods have not been searched`,
        withReplies: 'Include replies',
        clearCache: 'Clear cache',
        startFrom: 'Start month',
        resolving: 'Loading account…',
        searching: (d) => `Looking for posts after ${d}…`,
        rate: (t) => `X's search rate limit was reached. Continuing automatically at ${t}`,
        end: (d) => `End of this search range (up to ${d})`,
        none: 'No retrievable posts were found in this range',
        incompatible: 'Not compatible with the current X page. Reload and try again',
        auth: 'Sign in to X first, then try again',
        unavailable: "This account's history cannot be retrieved right now",
        failed: 'Loading failed',
        retry: 'Retry',
        replyingTo: (n) => `Replying to @${n}`,
        quoteMissing: 'Quoted post unavailable',
        mediaMissing: 'View media in the original post',
        stats: (c) => `${c.replies} replies · ${c.reposts} reposts · ${c.likes} likes`,
      };

  const fmtDay = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric' });
  const fmtMonth = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long' });
  // Search windows and the start month are UTC, so their labels are formatted in UTC too.
  const fmtMonthUtc = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', timeZone: 'UTC' });
  const fmtFull =new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  const fmtClock = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' });

  const RESERVED = new Set(['home', 'explore', 'search', 'notifications', 'messages', 'i', 'settings', 'compose', 'jobs', 'hashtag']);

  const sessions = new Map();
  let active = null;
  let suspended = null; // { key, scrollY } while the user is away on a post page

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c) el.append(c);
    return el;
  }

  // ---- Page detection ----

  const path = () => location.pathname.replace(/\/+$/, '').toLowerCase();

  function findProfile() {
    const pc = document.querySelector('[data-testid="primaryColumn"]');
    if (!pc || !pc.querySelector('[data-testid="UserName"]')) return null;
    const tablist = pc.querySelector('nav [role="tablist"]');
    const first = tablist && tablist.querySelector('a[role="tab"]');
    if (!first) return null;
    const sn = first.pathname.slice(1);
    if (!/^\w{1,15}$/.test(sn) || RESERVED.has(sn.toLowerCase())) return null;
    if (path().split('/')[1] !== sn.toLowerCase()) return null;
    const nav = tablist.closest('nav');
    const section = pc.querySelector('section[role="region"]');
    const host = section ? section.parentElement : nav.parentElement && nav.parentElement.parentElement;
    if (!host) return null;
    return { sn, key: sn.toLowerCase(), tablist, host };
  }

  const onProfileRoot = (key) => path() === '/' + key;

  // X's router listens for popstate, so this navigates without a full page load.
  function navigate(to) {
    if (active) active.lastY = window.scrollY;
    history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }

  // ---- Theme ----

  function applyTheme(tablist) {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [255, 255, 255];
    const [r, g, b] = m.map(Number);
    const theme =
      r + g + b > 600
        ? { text: '#0f1419', sub: '#536471', border: '#eff3f4', hover: 'rgba(0,0,0,0.03)' }
        : r + g + b < 30
          ? { text: '#e7e9ea', sub: '#71767b', border: '#2f3336', hover: 'rgba(255,255,255,0.03)' }
          : { text: '#f7f9f9', sub: '#8b98a5', border: '#38444d', hover: 'rgba(255,255,255,0.03)' };
    let accent = '#1d9bf0';
    const indicator = findIndicator(tablist);
    if (indicator) accent = getComputedStyle(indicator).backgroundColor;
    const style = document.documentElement.style;
    style.setProperty('--xo-bg', `rgb(${r}, ${g}, ${b})`);
    style.setProperty('--xo-text', theme.text);
    style.setProperty('--xo-sub', theme.sub);
    style.setProperty('--xo-border', theme.border);
    style.setProperty('--xo-hover', theme.hover);
    style.setProperty('--xo-accent', accent);
  }

  // The underline of X's currently selected native tab.
  function findIndicator(tablist) {
    const sel = tablist.querySelector('a[aria-selected="true"]:not([data-xo-a])');
    if (!sel) return null;
    return [...sel.querySelectorAll('div')].find((d) => d.childElementCount === 0 && getComputedStyle(d).height === '4px') || null;
  }

  // ---- Tab ----

  function ensureTab(p) {
    let item = p.tablist.querySelector('[data-xo-tab]');
    if (!item) {
      const template = [...p.tablist.children].reverse().find((c) => c.querySelector('a[role="tab"][aria-selected="false"]'));
      if (!template) return;
      item = template.cloneNode(true);
      item.setAttribute('data-xo-tab', '');
      const a = item.querySelector('a[role="tab"]');
      a.setAttribute('data-xo-a', '');
      a.setAttribute('href', '/' + p.sn);
      a.removeAttribute('tabindex');
      const label = [...a.querySelectorAll('span')].find((s) => s.childElementCount === 0 && s.textContent.trim());
      if (label) label.textContent = T.tab;
      else a.textContent = T.tab;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const now = findProfile();
        if (!now) return;
        if (active && active.key === now.key) deactivate(true);
        else if (onProfileRoot(now.key)) activate(now);
        else {
          suspended = { key: now.key, scrollY: 0 };
          navigate('/' + now.sn);
        }
      });
      p.tablist.append(item);
    }
    if (!p.tablist.hasAttribute('data-xo-bound')) {
      p.tablist.setAttribute('data-xo-bound', '');
      p.tablist.addEventListener(
        'click',
        (e) => {
          const tab = e.target.closest('[role="tab"]');
          if (tab && !tab.hasAttribute('data-xo-a')) {
            suspended = null;
            deactivate(true);
          }
        },
        true,
      );
    }
    item.toggleAttribute('data-xo-on', !!active && active.key === p.key);
    if (active && active.key === p.key) {
      const indicator = findIndicator(p.tablist);
      if (indicator) indicator.setAttribute('data-xo-hide', '');
    }
  }

  // ---- Sessions ----

  function getSession(p) {
    let s = sessions.get(p.key);
    if (!s) {
      s = {
        key: p.key,
        sn: p.sn,
        user: null,
        reader: null,
        tweets: [],
        opts: { withReplies: false, start: null },
        t0: Date.now(),
        status: { kind: 'idle' },
        loading: false,
        done: false,
        near: false,
        lastY: 0,
        els: null,
        skipCache: false, // set by restart(), which has just cleared the cache
        cacheChecked: false,
        resume: null, // { cursor, span } read from the cache
        anchor: null, // { id, offset }: the post at the top of the viewport
        rev: null, // cache revision this tab last read or wrote
      };
      sessions.set(p.key, s);
    }
    return s;
  }

  function activate(p, restoreY) {
    const s = getSession(p);
    active = s;
    setFlag(s.key);
    document.documentElement.setAttribute('data-xo-active', '');
    applyTheme(p.tablist);
    mount(s, p);
    ensureTab(p);
    if (!s.reader && !s.loading) start(s);
    if (restoreY != null) {
      for (const delay of [0, 120, 400]) setTimeout(() => active === s && window.scrollTo(0, restoreY), delay);
    }
  }

  // `explicit` is a deliberate exit by the user, as opposed to navigating to a post and back.
  function deactivate(explicit) {
    if (explicit) setFlag(null);
    if (!active) return;
    saveProgress(active);
    active = null;
    document.documentElement.removeAttribute('data-xo-active');
    document.querySelectorAll('[data-xo-tab][data-xo-on]').forEach((el) => el.removeAttribute('data-xo-on'));
    document.querySelectorAll('[data-xo-hide]').forEach((el) => el.removeAttribute('data-xo-hide'));
  }

  function restart(s, opts) {
    const p = findProfile();
    if (!p || p.key !== s.key) return;
    if (s.reader) s.reader.cancel();
    clearTimeout(s.waitTimer);
    sessions.delete(s.key);
    E.store.clear(s.key);
    const fresh = getSession(p);
    fresh.user = s.user;
    fresh.opts = opts;
    fresh.skipCache = true;
    activate(p);
  }

  // ---- Cache and reading position ----

  const FLAG = 'xo-active';

  // Remembers, for this browser tab only, that the view was on, so a reload reopens it.
  function setFlag(key) {
    try {
      if (key) sessionStorage.setItem(FLAG, key);
      else sessionStorage.removeItem(FLAG);
    } catch {}
  }

  function saveProgress(s, batch) {
    // Once a batch failed to store, saving a later cursor would hide those posts after a reload.
    if (!s.reader || s.cacheBroken || sessions.get(s.key) !== s) return;
    const meta = {
      key: s.key,
      sn: s.sn,
      user: s.user,
      opts: s.opts,
      cursor: s.reader.cursor,
      span: s.reader.span,
      anchor: s.anchor,
      updatedAt: Date.now(),
      rev: Math.random().toString(36).slice(2),
    };
    const expected = s.rev;
    s.rev = meta.rev;
    const posts = batch || [];
    E.store.write(meta, posts, s.tweets.length - posts.length, expected).then((ok) => {
      if (!ok) s.cacheBroken = true; // write failed, or another tab changed this profile's cache
    });
  }

  async function restoreFromCache(s) {
    if (s.skipCache || s.cacheChecked) return;
    s.cacheChecked = true;
    const cached = await E.store.load(s.key);
    if (!cached || sessions.get(s.key) !== s) return;
    s.user = cached.meta.user;
    s.opts = cached.meta.opts;
    s.tweets = cached.tweets;
    s.resume = { cursor: cached.meta.cursor, span: cached.meta.span };
    s.anchor = cached.meta.anchor || null;
    s.rev = cached.meta.rev || null;
    if (s.els) {
      s.els.replies.checked = !!s.opts.withReplies;
      s.els.month.value = s.opts.start ? new Date(s.opts.start * 1000).toISOString().slice(0, 7) : '';
      appendCards(s, s.tweets);
    }
    scrollToAnchor(s);
  }

  function updateAnchor(s) {
    if (!s.els || !s.els.root.isConnected) return;
    const rect = s.els.list.getBoundingClientRect();
    const probeY = 140; // just below X's sticky header
    if (rect.top > probeY) {
      s.anchor = null;
      return;
    }
    const hit = document.elementFromPoint(rect.left + rect.width / 2, probeY);
    const el = hit && hit.closest('.xo-card');
    if (el) s.anchor = { id: el.getAttribute('data-id'), offset: Math.round(el.getBoundingClientRect().top) };
  }

  function scrollToAnchor(s) {
    const a = s.anchor;
    const el = a && s.els && s.els.list.querySelector(`.xo-card[data-id="${a.id}"]`);
    if (!el) return;
    // Repeated because card heights settle as off-screen cards are laid out.
    const go = () => {
      if (active === s && el.isConnected) window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - a.offset);
    };
    go();
    setTimeout(go, 150);
    setTimeout(go, 500);
  }

  async function start(s) {
    s.loading = true;
    setStatus(s, { kind: 'resolving' });
    try {
      await restoreFromCache(s);
      if (!s.user) s.user = await E.resolveUser(s.sn);
      const joined = s.user.createdAt ? Math.floor(s.user.createdAt / 1000) - DAY : Date.UTC(2006, 2, 1) / 1000;
      // A start before the account existed would only burn searches on empty windows.
      if (s.opts.start != null && s.opts.start <= joined) {
        s.opts.start = null;
        if (s.els) s.els.month.value = '';
      }
      s.reader = new E.Reader(s.user, {
        start: s.resume ? s.resume.cursor : s.opts.start ?? joined,
        end: Math.floor(s.t0 / 1000),
        withReplies: s.opts.withReplies,
        span: s.resume && s.resume.span,
        seenIds: s.tweets.map((t) => t.id),
      });
    } catch (e) {
      s.loading = false;
      setStatus(s, { kind: 'error', error: e });
      return;
    }
    s.loading = false;
    setStatus(s, { kind: 'idle' });
    loadMore(s);
  }

  async function loadMore(s) {
    if (sessions.get(s.key) !== s) return; // replaced by a restart
    if (s.loading || s.done || !s.reader || s.waitTimer || document.hidden) return;
    s.loading = true;
    let next = { kind: 'idle' };
    try {
      const batch = await s.reader.next((p) => setStatus(s, { kind: 'searching', from: p.from }));
      s.tweets.push(...batch);
      saveProgress(s, batch);
      if (s.els && s.els.root.isConnected) appendCards(s, batch);
      if (s.reader.done) {
        s.done = true;
        next = { kind: 'end' };
      }
    } catch (e) {
      if (e.kind === 'cancelled') return;
      saveProgress(s); // keeps the windows already found empty
      if (e.kind === 'rate') {
        next = { kind: 'rate', resetAt: e.resetAt };
        s.waitTimer = setTimeout(() => {
          s.waitTimer = null;
          setStatus(s, { kind: 'idle' });
          if (active === s && s.near) loadMore(s);
        }, Math.max(e.resetAt - Date.now(), 0) + 3000);
      } else {
        next = { kind: 'error', error: e };
      }
    } finally {
      s.loading = false;
    }
    setStatus(s, next);
    if (next.kind === 'idle' && active === s && s.near) setTimeout(() => loadMore(s), 0);
  }

  // ---- Rendering ----

  function mount(s, p) {
    if (s.els && s.els.root.isConnected && s.els.root.parentElement === p.host) return;
    document.querySelectorAll('#xo-root').forEach((el) => el.remove());
    if (s.els) s.els.observer.disconnect();

    const earliest = h('span', { class: 'xo-earliest' });
    const replies = h('input', { type: 'checkbox' });
    replies.checked = s.opts.withReplies;
    replies.addEventListener('change', () => restart(s, { ...s.opts, withReplies: replies.checked }));
    const month = h('input', { type: 'month', 'aria-label': T.startFrom });
    if (s.opts.start) month.value = new Date(s.opts.start * 1000).toISOString().slice(0, 7);
    month.min = '2006-03';
    month.max = new Date(s.t0).toISOString().slice(0, 7);
    month.addEventListener('change', () => {
      // Typing a year fires change on partial values such as 0002; restarting on those would
      // rebuild this input mid-entry.
      if (month.value && (month.value < month.min || month.value > month.max)) return;
      const start = month.value ? Date.parse(month.value + '-01T00:00:00Z') / 1000 : null;
      if (start === s.opts.start) return;
      restart(s, { ...s.opts, start });
    });

    const list = h('div', { class: 'xo-list' });
    const status = h('div', { class: 'xo-status' });
    const root = h(
      'div',
      { id: 'xo-root' },
      h(
        'div',
        { class: 'xo-bar' },
        earliest,
        h('label', { class: 'xo-opt' }, replies, h('span', { text: T.withReplies })),
        h('label', { class: 'xo-opt' }, h('span', { text: T.startFrom }), month),
        h('button', { class: 'xo-clear', type: 'button', text: T.clearCache, onclick: () => restart(s, s.opts) }),
      ),
      list,
      status,
    );
    root.addEventListener('click', onRootClick);

    const observer = new IntersectionObserver(
      (entries) => {
        s.near = entries[entries.length - 1].isIntersecting;
        if (s.near && active === s) loadMore(s);
      },
      { rootMargin: '2000px 0px' },
    );
    observer.observe(status);

    s.els = { root, list, status, earliest, replies, month, observer };
    s.renderedMonth = null;
    p.host.append(root);
    appendCards(s, s.tweets);
    setStatus(s, s.status);
  }

  function setStatus(s, status) {
    s.status = status;
    if (!s.els) return;
    const { status: el, earliest } = s.els;

    earliest.textContent = s.opts.start
      ? T.fromDate(fmtMonthUtc.format(s.opts.start * 1000))
      : s.tweets.length
        ? T.earliest(fmtDay.format(s.tweets[0].createdAt))
        : '';

    el.replaceChildren();
    el.removeAttribute('data-kind');
    if (status.kind === 'idle') return;
    el.setAttribute('data-kind', status.kind);
    if (status.kind === 'resolving') el.append(T.resolving);
    else if (status.kind === 'searching') el.append(T.searching(fmtMonthUtc.format(status.from * 1000)));
    else if (status.kind === 'rate') el.append(T.rate(fmtClock.format(status.resetAt + 3000)));
    else if (status.kind === 'end') el.append(s.tweets.length ? T.end(fmtFull.format(s.t0)) : T.none);
    else if (status.kind === 'error') {
      const kind = status.error && status.error.kind;
      const known = kind === 'incompatible' || kind === 'auth' || kind === 'unavailable';
      const detail = status.error && status.error.message ? ` (${status.error.message})` : '';
      el.append(known ? T[kind] : T.failed + detail);
      if (kind !== 'unavailable') {
        el.append(
          h('button', {
            class: 'xo-retry',
            type: 'button',
            text: T.retry,
            onclick: () => {
              setStatus(s, { kind: 'idle' });
              if (s.reader) loadMore(s);
              else start(s);
            },
          }),
        );
      }
    }
  }

  function appendCards(s, tweets) {
    if (!tweets.length) return;
    const frag = document.createDocumentFragment();
    for (const t of tweets) {
      const d = new Date(t.createdAt);
      const key = d.getFullYear() * 12 + d.getMonth();
      if (key !== s.renderedMonth) {
        s.renderedMonth = key;
        frag.append(h('div', { class: 'xo-month', text: fmtMonth.format(d) }));
      }
      frag.append(card(t));
    }
    s.els.list.append(frag);
  }

  const statusPath = (t) => `/${t.user ? t.user.screenName : 'i'}/status/${t.id}`;

  function header(t) {
    const u = t.user || { name: '', screenName: '' };
    return h(
      'div',
      { class: 'xo-head' },
      h('a', { class: 'xo-name', href: '/' + u.screenName, text: u.name }),
      h('span', { class: 'xo-handle', text: '@' + u.screenName }),
      h('span', { class: 'xo-dot', text: '·' }),
      h('a', { class: 'xo-time', href: statusPath(t), title: fmtFull.format(t.createdAt), text: fmtDay.format(t.createdAt) }),
    );
  }

  function textBlock(t) {
    if (!t.segments.length) return null;
    return h(
      'div',
      { class: 'xo-text', dir: 'auto' },
      t.segments.map((seg) => {
        if (seg.type === 'text') return document.createTextNode(seg.text);
        const external = seg.type === 'link';
        return h('a', {
          href: seg.href,
          text: seg.text,
          target: external ? '_blank' : null,
          rel: external ? 'noopener noreferrer' : null,
        });
      }),
    );
  }

  function mediaBlock(t) {
    if (!t.media.length) return null;
    const first = t.media[0];
    if (first.type !== 'photo') {
      if (!first.video) return h('a', { class: 'xo-placeholder', href: statusPath(t), text: T.mediaMissing });
      const video = h('video', {
        class: 'xo-video',
        src: first.video,
        poster: first.url,
        preload: 'none',
        controls: true,
        playsinline: true,
        loop: first.type === 'animated_gif',
      });
      if (first.type === 'animated_gif') video.muted = true;
      if (first.w && first.h) video.style.aspectRatio = `${first.w} / ${first.h}`;
      return h('div', { class: 'xo-media', 'data-n': '1' }, video);
    }
    const photos = t.media.filter((m) => m.type === 'photo').slice(0, 4);
    return h(
      'div',
      { class: 'xo-media', 'data-n': String(photos.length) },
      photos.map((m) => {
        const img = h('img', {
          class: 'xo-photo',
          src: `${m.url}?name=${photos.length === 1 ? 'medium' : 'small'}`,
          alt: m.alt,
          loading: 'lazy',
          // X numbers the slots across all media, including videos.
          'data-href': `${statusPath(t)}/photo/${t.media.indexOf(m) + 1}`,
        });
        if (photos.length === 1 && m.w && m.h) img.style.aspectRatio = `${m.w} / ${m.h}`;
        return img;
      }),
    );
  }

  function quoteBlock(t) {
    if (t.quoted) {
      const q = t.quoted;
      return h(
        'div',
        { class: 'xo-quote', 'data-href': statusPath(q) },
        h('div', { class: 'xo-qhead' }, q.user && q.user.avatar ? h('img', { class: 'xo-qavatar', src: q.user.avatar, alt: '' }) : null, header(q)),
        textBlock(q),
        mediaBlock(q),
      );
    }
    if (t.quoteMissing) return h('div', { class: 'xo-quote xo-missing', text: T.quoteMissing });
    return null;
  }

  function card(t) {
    const u = t.user || {};
    return h(
      'article',
      { class: 'xo-card', 'data-id': t.id, 'data-href': statusPath(t) },
      h('a', { class: 'xo-avatar', href: '/' + (u.screenName || ''), tabindex: '-1' }, u.avatar ? h('img', { src: u.avatar, alt: '' }) : null),
      h(
        'div',
        { class: 'xo-body' },
        header(t),
        t.replyTo ? h('div', { class: 'xo-replyto', text: T.replyingTo(t.replyTo) }) : null,
        textBlock(t),
        mediaBlock(t),
        quoteBlock(t),
        h('div', { class: 'xo-stats', text: T.stats(t.counts) }),
      ),
    );
  }

  function onRootClick(e) {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = e.target.closest('a[href]');
    if (a) {
      if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || a.origin !== location.origin) return;
      e.preventDefault();
      navigate(a.pathname + a.search);
      return;
    }
    if (e.target.closest('video, button, input, label')) return;
    if (String(window.getSelection())) return;
    const target = e.target.closest('[data-href]');
    if (!target) return;
    const to = target.getAttribute('data-href');
    if (e.metaKey || e.ctrlKey) window.open(to, '_blank', 'noopener');
    else navigate(to);
  }

  // ---- Lifecycle ----

  function tick() {
    // X's compose and other dialogs get their own URL while the page underneath stays put.
    if (/^\/(compose|intent)\//.test(path())) return;
    const p = findProfile();
    if (p) ensureTab(p);
    if (active) {
      if (!p || p.key !== active.key || !onProfileRoot(active.key)) {
        suspended = { key: active.key, scrollY: active.lastY };
        deactivate();
      } else {
        mount(active, p);
      }
    } else if (suspended && !/^\/\w+\/status\//.test(path()) && !onProfileRoot(suspended.key)) {
      // Only a round trip to a post page resumes the view; wandering elsewhere drops it.
      suspended = null;
      setFlag(null);
    } else if (suspended && p) {
      if (p.key !== suspended.key) {
        suspended = null;
        setFlag(null);
      } else if (onProfileRoot(p.key)) {
        const y = suspended.scrollY;
        suspended = null;
        activate(p, y);
      }
    }
  }

  window.addEventListener(
    'scroll',
    () => {
      const s = active;
      if (!s || !onProfileRoot(s.key)) return;
      s.lastY = window.scrollY;
      if (s.anchorTimer) return;
      s.anchorTimer = setTimeout(() => {
        s.anchorTimer = null;
        if (active !== s || !onProfileRoot(s.key)) return;
        updateAnchor(s);
        saveProgress(s);
      }, 800);
    },
    { passive: true },
  );
  window.addEventListener('pagehide', () => {
    if (!active || !onProfileRoot(active.key)) return;
    updateAnchor(active);
    saveProgress(active);
  });

  // After a reload, reopen the view if it was on in this tab; the position comes from the cache.
  try {
    const key = sessionStorage.getItem(FLAG);
    if (key) suspended = { key, scrollY: null };
  } catch {}

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && active && active.near) loadMore(active);
  });
  setInterval(() => {
    try {
      tick();
    } catch (e) {
      console.warn('[x-oldest]', e);
    }
  }, 300);
})();
