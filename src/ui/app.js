// App: ties everything together. It owns the reading sessions, decides when the reading view is
// on, loads posts into it, and keeps up with X as the user moves around.
//
// X is a single-page app that re-renders and re-routes at will, without telling anyone. Rather
// than track every way that can happen, tick() looks at the page a few times a second and puts
// right whatever is missing. Everything it calls is therefore safe to repeat.
//
// Three variables say where things stand:
//   sessions   one session per profile visited, kept until the page is reloaded
//   active     the session whose reading view is showing, or null
//   suspended  set when the view was left by navigating away, so that coming back restores it
(() => {
  const E = window.__xoldest;
  if (!E || !E.ui || E.ui.started) return;
  E.ui.started = true;

  const { page, view } = E.ui;

  const DAY = 86400;
  const TICK_MS = 300;
  const FLAG = 'xo-active'; // sessionStorage key
  const FIRST_POST_TIME = Date.UTC(2006, 2, 1) / 1000; // fallback start when the join date is unknown
  const RATE_RESET_MARGIN_MS = 3000; // waited beyond the reset time X reports
  const ANCHOR_PROBE_Y = 140; // just below X's sticky header
  const ANCHOR_SAVE_DELAY_MS = 800;

  const sessions = new Map();
  let active = null;
  let suspended = null; // { key, scrollY }; scrollY is null when the position comes from the cache

  // ---- Sessions ----

  // A session is everything known about reading one profile.
  function getSession(p) {
    let s = sessions.get(p.key);
    if (!s) {
      s = {
        // Identity
        key: p.key,
        sn: p.sn,
        user: null, // resolved account; see engine/normalize.js
        opts: { withReplies: false, start: null }, // start: Unix seconds, or null for "the beginning"
        t0: Date.now(), // the search range ends here; later posts are not picked up

        // Loading
        reader: null,
        tweets: [], // everything loaded so far, in reading order
        status: { kind: 'idle' }, // what the status line shows; kinds are listed in view.js
        loading: false, // a start() or loadMore() is in progress
        done: false, // the reader reached the end of the range
        waitTimer: null, // set while waiting out a rate limit

        // View
        els: null, // DOM of the reading view; see view.js
        near: false, // the end of the list is near the viewport, so more should load
        lastY: 0, // last scroll position, to return to after visiting a post
        anchor: null, // { id, offset }: the post at the top of the viewport
        anchorTimer: null,

        // Cache
        skipCache: false, // set by restart(), which has just cleared the cache
        cacheChecked: false,
        cacheBroken: false, // a write was refused or failed; nothing more is written
        resume: null, // { cursor, span } read from the cache
        rev: null, // cache revision this tab last read or wrote
      };
      sessions.set(p.key, s);
    }
    return s;
  }

  function setStatus(s, status) {
    s.status = status;
    view.renderStatus(s);
  }

  // ---- Turning the view on and off ----

  // Turning the view on is one attribute on <html>: ui.css then hides X's timeline and shows ours.
  // X's own elements are never moved or removed, so turning it off restores the page exactly.
  function activate(p, restoreY) {
    const s = getSession(p);
    active = s;
    setFlag(s.key);
    document.documentElement.setAttribute('data-xo-active', '');
    page.applyTheme(p.tablist);
    view.mount(s, p);
    ensureTab(p);
    if (!s.reader && !s.loading) start(s);
    if (restoreY != null) {
      // Repeated because the page keeps settling for a moment after a route change.
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

  // Throws the session and its cache away and starts over with `opts`. The account is kept, so
  // it is not looked up again.
  function restart(s, opts) {
    const p = page.findProfile();
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

  // X's router listens for popstate, so this navigates without a full page load.
  function navigate(to) {
    if (active) active.lastY = window.scrollY;
    history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }

  // Remembers, for this browser tab only, that the view was on, so a reload reopens it.
  function setFlag(key) {
    try {
      if (key) sessionStorage.setItem(FLAG, key);
      else sessionStorage.removeItem(FLAG);
    } catch {}
  }

  // ---- Cache ----

  // Writes the session's progress, together with `batch` if new posts were just loaded.
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

  // Fills a new session from the cache, if there is one: posts, options, progress and position.
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
      view.syncControls(s);
      view.appendCards(s, s.tweets);
    }
    scrollToAnchor(s);
  }

  // ---- Reading position ----

  // The position is remembered as a post and its distance from the top of the viewport rather
  // than as a scroll offset, which would shift whenever anything above changes height.
  function updateAnchor(s) {
    if (!s.els || !s.els.root.isConnected) return;
    const rect = s.els.list.getBoundingClientRect();
    // Still above the list, in the profile header: no position to remember.
    if (rect.top > ANCHOR_PROBE_Y) {
      s.anchor = null;
      return;
    }
    const hit = document.elementFromPoint(rect.left + rect.width / 2, ANCHOR_PROBE_Y);
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

  // ---- Loading ----

  // Prepares a session for loading: cached state, the account, and a reader positioned where
  // reading should continue. Then loads the first batch.
  async function start(s) {
    s.loading = true;
    setStatus(s, { kind: 'resolving' });
    try {
      await restoreFromCache(s);
      if (!s.user) s.user = await E.resolveUser(s.sn);
      // Start a day before the join date, as a margin.
      const joined = s.user.createdAt ? Math.floor(s.user.createdAt / 1000) - DAY : FIRST_POST_TIME;
      // A start before the account existed would only burn searches on empty windows.
      if (s.opts.start != null && s.opts.start <= joined) {
        s.opts.start = null;
        view.syncControls(s);
      }
      s.reader = E.openReader(s.user, {
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

  // Loads one batch and shows it, then goes again for as long as the end of the list stays near
  // the viewport. Does nothing when a load is already running, finished, waiting or pointless.
  async function loadMore(s) {
    if (sessions.get(s.key) !== s) return; // replaced by a restart
    if (s.loading || s.done || !s.reader || s.waitTimer || document.hidden) return;
    s.loading = true;
    let next = { kind: 'idle' };
    try {
      const batch = await s.reader.next((p) => setStatus(s, { kind: 'searching', from: p.from }));
      s.tweets.push(...batch);
      saveProgress(s, batch);
      if (s.els && s.els.root.isConnected) view.appendCards(s, batch);
      if (s.reader.done) {
        s.done = true;
        next = { kind: 'end' };
      }
    } catch (e) {
      if (e.kind === 'cancelled') return;
      saveProgress(s); // keeps the windows already found empty
      if (e.kind === 'rate') {
        next = { kind: 'rate', resumeAt: e.resetAt + RATE_RESET_MARGIN_MS };
        s.waitTimer = setTimeout(() => {
          s.waitTimer = null;
          setStatus(s, { kind: 'idle' });
          if (active === s && s.near) loadMore(s);
        }, Math.max(e.resetAt - Date.now(), 0) + RATE_RESET_MARGIN_MS);
      } else {
        next = { kind: 'error', error: e };
      }
    } finally {
      s.loading = false;
    }
    setStatus(s, next);
    if (next.kind === 'idle' && active === s && s.near) setTimeout(() => loadMore(s), 0);
  }

  function retry(s) {
    setStatus(s, { kind: 'idle' });
    if (s.reader) loadMore(s);
    else start(s);
  }

  // ---- Tab ----

  // Makes sure our tab is in the profile's tab bar and shows the right state.
  function ensureTab(p) {
    let item = p.tablist.querySelector('[data-xo-tab]');
    if (!item) {
      item = page.createTab(p);
      if (!item) return;
      item.querySelector('[data-xo-a]').addEventListener('click', onOurTabClick);
      p.tablist.append(item);
    }
    if (!p.tablist.hasAttribute('data-xo-bound')) {
      p.tablist.setAttribute('data-xo-bound', '');
      // Capture phase, so the view is off before X handles the click and renders its timeline.
      p.tablist.addEventListener('click', onNativeTabClick, true);
    }
    const on = !!active && active.key === p.key;
    item.toggleAttribute('data-xo-on', on);
    if (on) {
      // Only one tab may look selected, so the underline of X's selected tab is hidden.
      const indicator = page.findIndicator(p.tablist);
      if (indicator) indicator.setAttribute('data-xo-hide', '');
    }
  }

  // Our tab toggles the view. From another profile tab (Replies, Media…) it first goes to the
  // profile's main tab, and tick() turns the view on once that has rendered.
  function onOurTabClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const now = page.findProfile();
    if (!now) return;
    if (active && active.key === now.key) deactivate(true);
    else if (page.onProfileRoot(now.key)) activate(now);
    else {
      suspended = { key: now.key, scrollY: 0 };
      navigate('/' + now.sn);
    }
  }

  function onNativeTabClick(e) {
    const tab = e.target.closest('[role="tab"]');
    if (tab && !tab.hasAttribute('data-xo-a')) {
      suspended = null;
      deactivate(true);
    }
  }

  // ---- Lifecycle ----

  function forgetSuspended() {
    suspended = null;
    setFlag(null);
  }

  function tick() {
    if (page.isOverlayRoute()) return;
    const p = page.findProfile();
    if (p) ensureTab(p);
    if (active) {
      if (!p || p.key !== active.key || !page.onProfileRoot(active.key)) {
        // The user navigated away. Remember where they were in case they come back.
        suspended = { key: active.key, scrollY: active.lastY };
        deactivate();
      } else {
        view.mount(active, p);
      }
    } else if (suspended && !page.isPostRoute() && !page.onProfileRoot(suspended.key)) {
      // Only a round trip to a post page resumes the view; wandering elsewhere drops it.
      forgetSuspended();
    } else if (suspended && p) {
      if (p.key !== suspended.key) {
        forgetSuspended();
      } else if (page.onProfileRoot(p.key)) {
        const y = suspended.scrollY;
        suspended = null;
        activate(p, y);
      }
    }
  }

  view.bind({
    restart,
    retry,
    navigate,
    nearEnd: (s) => {
      if (active === s) loadMore(s);
    },
  });

  // Track the reading position while scrolling, and save it once scrolling pauses.
  window.addEventListener(
    'scroll',
    () => {
      const s = active;
      if (!s || !page.onProfileRoot(s.key)) return;
      s.lastY = window.scrollY;
      if (s.anchorTimer) return;
      s.anchorTimer = setTimeout(() => {
        s.anchorTimer = null;
        if (active !== s || !page.onProfileRoot(s.key)) return;
        updateAnchor(s);
        saveProgress(s);
      }, ANCHOR_SAVE_DELAY_MS);
    },
    { passive: true },
  );
  window.addEventListener('pagehide', () => {
    if (!active || !page.onProfileRoot(active.key)) return;
    updateAnchor(active);
    saveProgress(active);
  });

  // After a reload, reopen the view if it was on in this tab; the position comes from the cache.
  try {
    const key = sessionStorage.getItem(FLAG);
    if (key) suspended = { key, scrollY: null };
  } catch {}

  // Loading pauses while the tab is hidden; pick it up again when it is shown.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && active && active.near) loadMore(active);
  });
  setInterval(() => {
    try {
      tick();
    } catch (e) {
      console.warn('[x-oldest]', e);
    }
  }, TICK_MS);
})();
