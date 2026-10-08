// Transport: how the extension talks to X's internal GraphQL API.
//
// This file runs in the page's MAIN world at document_start, before X's own scripts, so that it can
//   1. observe the request headers and feature-flag values X itself sends, and
//   2. reach X's webpack runtime, which holds the operation ids and the request signer.
// Everything a request needs is borrowed from X at runtime. Nothing is hard-coded, nothing is
// persisted, and the only requests made are same-origin reads to x.com.
//
// Exports on window.__xoldest: XoError, gql(name, variables).
(() => {
  if (window.__xoldest) return;
  const E = (window.__xoldest = {});

  const MIN_INTERVAL_MS = 400; // spacing between our requests
  const OPERATIONS = ['SearchTimeline', 'UserByScreenName'];

  // Every failure carries a `kind`, so the UI can tell "nothing found" from "could not look".
  //   incompatible  X's page no longer has what we rely on
  //   auth          not signed in, or the session was rejected
  //   rate          rate limited; `resetAt` (ms) says when to try again
  //   http          network failure or unexpected HTTP status
  //   api           HTTP 200 whose body reports an error
  //   parse         a response we could not read
  //   unavailable   the account cannot be read
  //   cancelled     the reader was cancelled while a request was in flight
  class XoError extends Error {
    constructor(kind, message, extra) {
      super(message || kind);
      this.kind = kind;
      Object.assign(this, extra);
    }
  }

  // ---- Request context, observed from X's own GraphQL requests ----

  const observed = {
    headers: null, // the headers of X's latest authorised request, minus its signature
    features: {}, // every feature-flag value seen so far
  };

  const xhr = XMLHttpRequest.prototype;
  const origOpen = xhr.open;
  const origSetHeader = xhr.setRequestHeader;
  const origSend = xhr.send;

  // The wrappers only take notes; whatever goes wrong in them must never break X's request.
  xhr.open = function (method, url) {
    try {
      const u = String(url);
      this.__xo = u.includes('/i/api/graphql/') ? { url: u, headers: {} } : null;
    } catch {
      this.__xo = null;
    }
    return origOpen.apply(this, arguments);
  };

  xhr.setRequestHeader = function (name, value) {
    try {
      if (this.__xo) this.__xo.headers[String(name).toLowerCase()] = String(value);
    } catch {}
    return origSetHeader.apply(this, arguments);
  };

  xhr.send = function (body) {
    try {
      if (this.__xo) observe(this.__xo, body);
    } catch {}
    return origSend.apply(this, arguments);
  };

  function observe(request, body) {
    if (request.headers.authorization) {
      const headers = { ...request.headers };
      delete headers['x-client-transaction-id']; // a signature is only valid for its own request
      observed.headers = headers;
    }
    // GET requests carry the flags in the URL, POST requests in the JSON body.
    let features = null;
    const inUrl = new URL(request.url, location.origin).searchParams.get('features');
    if (inUrl) features = JSON.parse(inUrl);
    else if (typeof body === 'string' && body.startsWith('{')) features = JSON.parse(body).features;
    if (features) Object.assign(observed.features, features);
  }

  // ---- X's webpack runtime: operation definitions and the request signer ----

  let webpackRequire = null;
  let runtime = null; // { ops, sign }, set once everything was found

  // Pushing a chunk with a runtime callback is how webpack hands out its `require` function.
  function getRequire() {
    if (webpackRequire) return webpackRequire;
    const key = Object.keys(window).find((k) => k.startsWith('webpackChunk'));
    if (!key) throw new XoError('incompatible', 'webpack runtime not found');
    let req;
    window[key].push([[Symbol('xoldest')], {}, (r) => { req = r; }]);
    if (!req || !req.m) throw new XoError('incompatible', 'webpack require not available');
    webpackRequire = req;
    return req;
  }

  // Reads `key:["a","b"]` out of an operation's metadata source text.
  function parseList(meta, key) {
    const m = meta.match(new RegExp(key + ':\\[([^\\]]*)\\]'));
    return m && m[1] ? m[1].split(',').map((s) => s.replace(/"/g, '')) : [];
  }

  // Module ids change with every X release, so modules are found by what their source contains.
  function loadRuntime() {
    if (runtime) return runtime;
    const req = getRequire();
    const ops = {};
    let signer = null;
    const opRe = new RegExp(
      'queryId:"([\\w-]+)",operationName:"(' + OPERATIONS.join('|') + ')",operationType:"query",metadata:\\{([^}]*)\\}',
      'g',
    );
    for (const id of Object.keys(req.m)) {
      const src = Function.prototype.toString.call(req.m[id]);
      // Several modules mention the signature header; the signer itself is the smallest of them.
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
    for (const name of OPERATIONS) {
      if (!ops[name]) throw new XoError('incompatible', 'operation not found: ' + name);
    }
    if (!signer) throw new XoError('incompatible', 'request signer not found');
    // The signer module exports one function taking (host, path, method).
    const gen = Object.values(req(signer.id)).find((f) => typeof f === 'function' && f.length === 3);
    if (!gen) throw new XoError('incompatible', 'request signer export not found');
    runtime = { ops, sign: (path, method) => gen('https://x.com', path, method) };
    return runtime;
  }

  // ---- Requests ----

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? m[1] : null;
  }

  // All requests go through one serial queue with a minimum spacing.
  let queue = Promise.resolve();
  let lastRequestAt = 0;

  function enqueue(fn) {
    const run = queue.then(async () => {
      const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await fn();
      } finally {
        lastRequestAt = Date.now();
      }
    });
    queue = run.catch(() => {}); // one failed request must not block the ones behind it
    return run;
  }

  const flags = (names, valueOf) => JSON.stringify(Object.fromEntries(names.map((k) => [k, valueOf(k)])));

  // Runs one GraphQL query and resolves to its `data`. Rejects with an XoError.
  function gql(name, variables) {
    return enqueue(async () => {
      const { ops, sign } = loadRuntime();
      if (!observed.headers) throw new XoError('incompatible', 'no request context captured yet; reload the page');

      const op = ops[name];
      const path = `/i/api/graphql/${op.queryId}/${name}`;
      const params = new URLSearchParams();
      params.set('variables', JSON.stringify(variables));
      // Send exactly the flags this operation declares, with the values X is using.
      params.set('features', flags(op.switches, (k) => observed.features[k] ?? false));
      if (op.toggles.length) params.set('fieldToggles', flags(op.toggles, () => false));

      const headers = { ...observed.headers };
      const csrf = cookie('ct0');
      if (csrf) headers['x-csrf-token'] = csrf;
      headers['x-client-transaction-id'] = await sign(path, 'GET');

      let res;
      try {
        res = await fetch(`${path}?${params}`, { headers, credentials: 'include' });
      } catch (e) {
        throw new XoError('http', 'network error: ' + e.message);
      }
      if (res.status === 429) {
        const reset = res.headers.get('x-rate-limit-reset'); // Unix seconds
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
      // X reports some failures with HTTP 200; those must not pass for an empty result.
      if (!json.data) {
        const msg = (json.errors || []).map((e) => e.message).join('; ');
        throw new XoError('api', msg || 'response has no data');
      }
      return json.data;
    });
  }

  E.XoError = XoError;
  E.gql = gql;
})();
