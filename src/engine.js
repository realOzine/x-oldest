// Data engine. Runs in the page's MAIN world at document_start so it can see the
// request headers X itself sends and call X's own request-signing module.
// Nothing here is persisted or sent anywhere except same-origin read requests to x.com.
(() => {
  if (window.__xoldest) return;

  const DAY = 86400;
  const PAGE_SIZE = 20;
  const FULL_PAGE = PAGE_SIZE - 2; // pages with more to come sometimes arrive a post or two short
  const MIN_INTERVAL_MS = 400;
  const OPS = ['SearchTimeline', 'UserByScreenName'];

  class XoError extends Error {
    constructor(kind, message, extra) {
      super(message || kind);
      this.kind = kind; // 'incompatible' | 'auth' | 'rate' | 'http' | 'api' | 'parse' | 'unavailable' | 'cancelled'
      Object.assign(this, extra);
    }
  }

  const state = {
    headers: null,
    features: {},
    require: null,
    ops: null,
    genTx: null,
    lastRequestAt: 0,
    queue: Promise.resolve(),
    rate: {},
  };

  // ---- Observe X's own GraphQL requests (headers + feature flag values only) ----

  const proto = XMLHttpRequest.prototype;
  const origOpen = proto.open;
  const origSetHeader = proto.setRequestHeader;
  const origSend = proto.send;

  proto.open = function (method, url) {
    try {
      const u = String(url);
      this.__xo = u.includes('/i/api/graphql/') ? { url: u, headers: {} } : null;
    } catch {
      this.__xo = null;
    }
    return origOpen.apply(this, arguments);
  };

  proto.setRequestHeader = function (name, value) {
    try {
      if (this.__xo) this.__xo.headers[String(name).toLowerCase()] = String(value);
    } catch {}
    return origSetHeader.apply(this, arguments);
  };

  proto.send = function (body) {
    try {
      if (this.__xo) observe(this.__xo, body);
    } catch {}
    return origSend.apply(this, arguments);
  };

  function observe(cap, body) {
    if (cap.headers.authorization) {
      const h = { ...cap.headers };
      delete h['x-client-transaction-id'];
      state.headers = h;
    }
    let features = null;
    const raw = new URL(cap.url, location.origin).searchParams.get('features');
    if (raw) features = JSON.parse(raw);
    else if (typeof body === 'string' && body.startsWith('{')) features = JSON.parse(body).features;
    if (features) Object.assign(state.features, features);
  }

  // ---- X's webpack runtime: operation definitions and the request signer ----

  function getRequire() {
    if (state.require) return state.require;
    const key = Object.keys(window).find((k) => k.startsWith('webpackChunk'));
    if (!key) throw new XoError('incompatible', 'webpack runtime not found');
    let req;
    window[key].push([[Symbol('xoldest')], {}, (r) => { req = r; }]);
    if (!req || !req.m) throw new XoError('incompatible', 'webpack require not available');
    state.require = req;
    return req;
  }

  function parseList(meta, key) {
    const m = meta.match(new RegExp(key + ':\\[([^\\]]*)\\]'));
    return m && m[1] ? m[1].split(',').map((s) => s.replace(/"/g, '')) : [];
  }

  function scanModules() {
    if (state.ops && state.genTx) return;
    const req = getRequire();
    const ops = {};
    let signer = null;
    const opRe = new RegExp(
      'queryId:"([\\w-]+)",operationName:"(' + OPS.join('|') + ')",operationType:"query",metadata:\\{([^}]*)\\}',
      'g',
    );
    for (const id of Object.keys(req.m)) {
      const src = Function.prototype.toString.call(req.m[id]);
      if (src.includes('x-client-transaction-id') && (!signer || src.length < signer.len)) {
        signer = { id, len: src.length };
      }
      if (!src.includes('operationName')) continue;
      for (const m of src.matchAll(opRe)) {
        ops[m[2]] = {
          queryId: m[1],
          switches: parseList(m[3], 'featureSwitches'),
          toggles: parseList(m[3], 'fieldToggles'),
        };
      }
    }
    for (const name of OPS) {
      if (!ops[name]) throw new XoError('incompatible', 'operation not found: ' + name);
    }
    if (!signer) throw new XoError('incompatible', 'request signer not found');
    const gen = Object.values(req(signer.id)).find((f) => typeof f === 'function' && f.length === 3);
    if (!gen) throw new XoError('incompatible', 'request signer export not found');
    state.ops = ops;
    state.genTx = (path, method) => gen('https://x.com', path, method);
  }

  // ---- Requests ----

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? m[1] : null;
  }

  // All requests go through one serial queue with a minimum spacing.
  function enqueue(fn) {
    const run = state.queue.then(async () => {
      const wait = state.lastRequestAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await fn();
      } finally {
        state.lastRequestAt = Date.now();
      }
    });
    state.queue = run.catch(() => {});
    return run;
  }

  function gql(name, variables) {
    return enqueue(async () => {
      scanModules();
      if (!state.headers) throw new XoError('incompatible', 'no request context captured yet; reload the page');
      const op = state.ops[name];
      const path = `/i/api/graphql/${op.queryId}/${name}`;
      const params = new URLSearchParams();
      params.set('variables', JSON.stringify(variables));
      params.set('features', JSON.stringify(Object.fromEntries(op.switches.map((k) => [k, state.features[k] ?? false]))));
      if (op.toggles.length) {
        params.set('fieldToggles', JSON.stringify(Object.fromEntries(op.toggles.map((k) => [k, false]))));
      }
      const headers = { ...state.headers };
      const csrf = cookie('ct0');
      if (csrf) headers['x-csrf-token'] = csrf;
      headers['x-client-transaction-id'] = await state.genTx(path, 'GET');

      let res;
      try {
        res = await fetch(`${path}?${params}`, { headers, credentials: 'include' });
      } catch (e) {
        throw new XoError('http', 'network error: ' + e.message);
      }
      const remaining = res.headers.get('x-rate-limit-remaining');
      const reset = res.headers.get('x-rate-limit-reset');
      if (reset) state.rate[name] = { remaining: Number(remaining), resetAt: Number(reset) * 1000 };

      if (res.status === 429) {
        throw new XoError('rate', 'rate limited', { resetAt: reset ? Number(reset) * 1000 : Date.now() + 60000 });
      }
      if (res.status === 401 || res.status === 403) throw new XoError('auth', 'HTTP ' + res.status);
      if (!res.ok) throw new XoError('http', 'HTTP ' + res.status);

      let json;
      try {
        json = await res.json();
      } catch {
        throw new XoError('parse', 'response is not JSON');
      }
      if (!json.data) {
        const msg = (json.errors || []).map((e) => e.message).join('; ');
        throw new XoError('api', msg || 'response has no data');
      }
      return json.data;
    });
  }

  // ---- Normalisation ----

  function decodeEntities(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  function normUser(u) {
    u = (u && u.result) || u;
    if (!u || !u.rest_id) return null;
    const lg = u.legacy || {};
    const core = u.core || {};
    return {
      id: u.rest_id,
      name: core.name ?? lg.name ?? '',
      screenName: core.screen_name ?? lg.screen_name ?? '',
      avatar: (u.avatar && u.avatar.image_url) ?? lg.profile_image_url_https ?? '',
      createdAt: Date.parse(core.created_at ?? lg.created_at ?? '') || null,
    };
  }

  function unwrapTweet(r) {
    if (r && r.__typename === 'TweetWithVisibilityResults') r = r.tweet;
    return r && r.rest_id && r.legacy ? r : null;
  }

  // Splits a post's text into plain text and link segments. Entity indices are in code points.
  function buildSegments(r, quotedId) {
    const lg = r.legacy;
    const note = r.note_tweet && r.note_tweet.note_tweet_results && r.note_tweet.note_tweet_results.result;
    const text = note ? note.text : lg.full_text;
    const ents = (note ? note.entity_set : lg.entities) || {};
    const cps = Array.from(text || '');
    const range = note ? [0, cps.length] : lg.display_text_range || [0, cps.length];
    const fix = note ? (s) => s : decodeEntities;

    const marks = [];
    for (const u of ents.urls || []) {
      const href = u.expanded_url || u.url;
      const isQuoteLink = quotedId && href && href.replace(/[?#].*$/, '').endsWith('/status/' + quotedId);
      marks.push({ s: u.indices[0], e: u.indices[1], type: isQuoteLink ? 'drop' : 'link', text: u.display_url || href, href });
    }
    for (const m of ents.user_mentions || []) {
      marks.push({ s: m.indices[0], e: m.indices[1], type: 'mention', href: '/' + m.screen_name });
    }
    for (const h of ents.hashtags || []) {
      marks.push({ s: h.indices[0], e: h.indices[1], type: 'hashtag', href: '/hashtag/' + encodeURIComponent(h.text) });
    }
    for (const c of ents.symbols || []) {
      marks.push({ s: c.indices[0], e: c.indices[1], type: 'cashtag', href: '/search?q=' + encodeURIComponent('$' + c.text) });
    }
    for (const m of (lg.entities && lg.entities.media) || []) {
      if (!note) marks.push({ s: m.indices[0], e: m.indices[1], type: 'drop' });
    }
    marks.sort((a, b) => a.s - b.s);

    const out = [];
    // Old posts carry no URL entities, so bare URLs in plain text are linked here.
    const pushText = (s, e) => {
      if (e <= s) return;
      const str = fix(cps.slice(s, e).join(''));
      let pos = 0;
      for (const m of str.matchAll(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g)) {
        if (m.index > pos) out.push({ type: 'text', text: str.slice(pos, m.index) });
        out.push({ type: 'link', text: m[0].replace(/^https?:\/\//, ''), href: m[0] });
        pos = m.index + m[0].length;
      }
      if (pos < str.length) out.push({ type: 'text', text: str.slice(pos) });
    };
    let pos = range[0];
    const end = Math.min(range[1], cps.length);
    for (const m of marks) {
      if (m.s < pos || m.e > end) continue;
      pushText(pos, m.s);
      if (m.type !== 'drop') out.push({ type: m.type, text: m.text || cps.slice(m.s, m.e).join(''), href: m.href });
      pos = m.e;
    }
    pushText(pos, end);

    while (out.length && out[out.length - 1].type === 'text') {
      const last = out[out.length - 1];
      last.text = last.text.replace(/\s+$/, '');
      if (last.text) break;
      out.pop();
    }
    return out;
  }

  function normMedia(lg) {
    const list = (lg.extended_entities && lg.extended_entities.media) || [];
    return list.map((m) => {
      const item = {
        type: m.type, // 'photo' | 'video' | 'animated_gif'
        url: m.media_url_https,
        w: (m.original_info && m.original_info.width) || 0,
        h: (m.original_info && m.original_info.height) || 0,
        alt: m.ext_alt_text || '',
      };
      if (m.video_info) {
        const mp4 = (m.video_info.variants || [])
          .filter((v) => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        item.video = mp4 ? mp4.url : null;
      }
      return item;
    });
  }

  function normTweet(result, depth = 0) {
    const r = unwrapTweet(result);
    if (!r) return null;
    const lg = r.legacy;
    const user = normUser(r.core && r.core.user_results);
    const quoted = depth === 0 && r.quoted_status_result ? normTweet(r.quoted_status_result.result, 1) : null;
    const quotedId = lg.quoted_status_id_str || (quoted && quoted.id) || null;
    return {
      id: r.rest_id,
      createdAt: Date.parse(lg.created_at),
      userId: lg.user_id_str || (user && user.id),
      user,
      segments: buildSegments(r, quotedId),
      media: normMedia(lg),
      quoted,
      quoteMissing: !!quotedId && !quoted,
      replyTo: lg.in_reply_to_status_id_str ? lg.in_reply_to_screen_name || '' : null,
      counts: { replies: lg.reply_count, reposts: lg.retweet_count, likes: lg.favorite_count },
    };
  }

  function findInstructions(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 8) return null;
    if (Array.isArray(o.instructions)) return o.instructions;
    for (const k of Object.keys(o)) {
      const r = findInstructions(o[k], depth + 1);
      if (r) return r;
    }
    return null;
  }

  // ---- API ----

  async function resolveUser(screenName) {
    const data = await gql('UserByScreenName', { screen_name: screenName, withGrokTranslatedBio: false });
    const result = data.user && data.user.result;
    const user = normUser(result);
    if (!user) throw new XoError('unavailable', (result && result.__typename) || 'user not found');
    // Protected accounts are not blocked here: search works for the owner and approved followers,
    // and simply finds nothing for everyone else.
    return user;
  }

  // One page (newest first) of a user's posts with since <= time < until, in Unix seconds.
  async function searchWindow(user, since, until, withReplies) {
    // since_time's boundary inclusiveness is not documented; overlap by a second and dedupe by id.
    const rawQuery =
      `from:${user.screenName} since_time:${since - 1} until_time:${until}` + (withReplies ? '' : ' -filter:replies');
    const data = await gql('SearchTimeline', {
      rawQuery,
      count: PAGE_SIZE,
      querySource: 'typed_query',
      product: 'Latest',
      withGrokTranslatedBio: false,
      withQuickPromoteEligibilityTweetFields: false,
    });
    const instructions = findInstructions(data);
    if (!instructions) throw new XoError('parse', 'timeline instructions not found');
    const tweets = [];
    for (const ins of instructions) {
      for (const entry of ins.entries || []) {
        if (!entry.entryId || !entry.entryId.startsWith('tweet-')) continue;
        const item = entry.content && entry.content.itemContent;
        const t = normTweet(item && item.tweet_results && item.tweet_results.result);
        if (t && t.userId === user.id && !Number.isNaN(t.createdAt)) tweets.push(t);
      }
    }
    return tweets;
  }

  const sec = (t) => Math.floor(t.createdAt / 1000);

  function byTimeThenId(a, b) {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    const x = BigInt(a.id);
    const y = BigInt(b.id);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  // Walks a user's history forward in time. Search only returns newest-first, and deep cursor
  // paging silently drops the oldest results, so each window is fetched by repeatedly moving
  // `until` back to the oldest post seen, then the whole window is committed in ascending order.
  class Reader {
    // `span` and `seenIds` carry on from a cached session; `start` is then its saved cursor.
    constructor(user, { start, end, withReplies, span, seenIds }) {
      this.user = user;
      this.withReplies = !!withReplies;
      this.cursor = start; // everything before this is already read
      this.end = end;
      this.span = span || 30 * DAY;
      this.seen = new Set(seenIds);
      this.pending = null; // window whose first page is in but whose walk is unfinished
      this.cancelled = false;
      this.requests = 0;
    }

    get done() {
      return this.cursor >= this.end;
    }

    cancel() {
      this.cancelled = true;
    }

    async page(since, until) {
      if (this.cancelled) throw new XoError('cancelled');
      this.requests++;
      const tweets = await searchWindow(this.user, since, until, this.withReplies);
      if (this.cancelled) throw new XoError('cancelled');
      return tweets;
    }

    // Returns the next non-empty batch in ascending order, or [] once the end is reached.
    async next(onProgress) {
      while (!this.done) {
        if (!this.pending) {
          const a = this.cursor;
          const b = Math.min(a + this.span, this.end);
          if (onProgress) onProgress({ from: a, to: b });
          const first = await this.page(a, b);

          if (!first.length) {
            this.cursor = b;
            this.span = Math.min(this.span * 2, 365 * DAY);
            continue;
          }

          // A full page that only reaches back a small part of the window means the window holds
          // many pages. Shrink it so the first screen does not wait for all of them.
          const oldest = Math.min(...first.map(sec));
          const covered = b - oldest;
          if (first.length >= FULL_PAGE && this.span > 3600 && covered < (b - a) / 2) {
            this.span = Math.max(3600, Math.min(covered * 2, Math.floor(this.span / 2)));
            continue;
          }
          this.pending = {
            a,
            b,
            got: new Map(first.map((t) => [t.id, t])),
            until: oldest + 1,
            complete: first.length < FULL_PAGE,
          };
        }

        // `pending` survives a thrown error (rate limit, network), so a retry resumes the walk
        // where it stopped instead of refetching the window from its newest page.
        // A short page is taken as the end of the window. That saves one request per window and
        // can occasionally miss posts, which is the accepted trade for speed.
        const w = this.pending;
        while (!w.complete) {
          const page = await this.page(w.a, w.until);
          const more = page.filter((t) => !w.got.has(t.id));
          more.forEach((t) => w.got.set(t.id, t));
          const nextUntil = more.length ? Math.min(...more.map(sec)) + 1 : w.until;
          // No progress means more than a page of posts within one second.
          if (page.length < FULL_PAGE || nextUntil >= w.until) w.complete = true;
          w.until = nextUntil;
        }
        this.pending = null;

        const batch = [...w.got.values()].filter((t) => !this.seen.has(t.id)).sort(byTimeThenId);
        batch.forEach((t) => this.seen.add(t.id));
        this.cursor = w.b;
        if (w.got.size < 8) this.span = Math.min(this.span * 2, 365 * DAY);
        if (batch.length) return batch;
      }
      return [];
    }
  }

  window.__xoldest = {
    XoError,
    resolveUser,
    Reader,
    rate: () => state.rate.SearchTimeline || null,
  };
})();
