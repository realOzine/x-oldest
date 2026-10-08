// View: the reading view's DOM. A toolbar, the list of cards and a status line.
//
// The view draws a session (see app.js) and reports what the user did; it decides nothing itself.
// Its elements are kept on the session as `s.els`:
//   root, list, status       the container, the cards, the line below them
//   earliest, replies, month toolbar parts
//   observer                 watches the status line to know when the end of the list is near
//   lastMonth                month of the last card added, to know when a month heading is due
// What the user does is passed to the `actions` given to bind():
//   restart(s, opts)   an option changed, or the cache is to be cleared
//   retry(s)           the retry button was pressed
//   nearEnd(s)         the end of the list came within reach of the viewport
//   navigate(url)      a link or card within X was clicked

import { card, h } from './cards.js';
import { T, fmt } from './i18n.js';

const FIRST_MONTH = '2006-03'; // when X opened
const PRELOAD_MARGIN = '2000px 0px'; // how far below the viewport counts as "near the end"

let actions = null;

export function bind(handlers) {
  actions = handlers;
}

// 'YYYY-MM' in UTC, the format of <input type="month">.
const isoMonth = (ms) => new Date(ms).toISOString().slice(0, 7);

// ---- Mounting ----

// Makes sure the session's view exists inside `p.host`, building it if X has re-rendered the
// page and thrown the previous one away. Safe to call repeatedly.
export function mount(s, p) {
  if (s.els && s.els.root.isConnected && s.els.root.parentElement === p.host) return;
  document.querySelectorAll('#xo-root').forEach((el) => el.remove());
  if (s.els) s.els.observer.disconnect();

  const earliest = h('span', { class: 'xo-earliest' });
  const replies = h('input', { type: 'checkbox' });
  replies.addEventListener('change', () => actions.restart(s, { ...s.opts, withReplies: replies.checked }));
  const month = h('input', { type: 'month', 'aria-label': T.startFrom });
  month.min = FIRST_MONTH;
  month.max = isoMonth(s.t0);
  month.addEventListener('change', () => {
    // Typing a year fires change on partial values such as 0002; restarting on those would
    // rebuild this input mid-entry.
    if (month.value && (month.value < month.min || month.value > month.max)) return;
    const start = month.value ? Date.parse(month.value + '-01T00:00:00Z') / 1000 : null;
    if (start === s.opts.start) return;
    actions.restart(s, { ...s.opts, start });
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
      h('button', { class: 'xo-clear', type: 'button', text: T.clearCache, onclick: () => actions.restart(s, s.opts) }),
    ),
    list,
    status,
  );
  root.addEventListener('click', onRootClick);

  // The status line sits below the last card, so it nearing the viewport means more is needed.
  const observer = new IntersectionObserver(
    (entries) => {
      s.near = entries[entries.length - 1].isIntersecting;
      if (s.near) actions.nearEnd(s);
    },
    { rootMargin: PRELOAD_MARGIN },
  );
  observer.observe(status);

  s.els = { root, list, status, earliest, replies, month, observer, lastMonth: null };
  syncControls(s);
  p.host.append(root);
  appendCards(s, s.tweets);
  renderStatus(s);
}

// Makes the toolbar controls show the session's options.
export function syncControls(s) {
  if (!s.els) return;
  s.els.replies.checked = !!s.opts.withReplies;
  s.els.month.value = s.opts.start ? isoMonth(s.opts.start * 1000) : '';
}

// ---- Status ----

// Draws `s.status` below the list, and the "earliest post" note in the toolbar.
//   idle       nothing to show
//   resolving  looking up the account
//   searching  fetching the window that starts at `from` (Unix seconds)
//   rate       rate limited; loading resumes at `resumeAt` (ms)
//   end        the whole range has been read
//   error      `error` is the XoError
export function renderStatus(s) {
  if (!s.els) return;
  const { status: el, earliest } = s.els;
  const status = s.status;

  // With a chosen start month the first post shown is not the earliest known, so say that instead.
  earliest.textContent = s.opts.start
    ? T.fromDate(fmt.monthUtc.format(s.opts.start * 1000))
    : s.tweets.length
      ? T.earliest(fmt.day.format(s.tweets[0].createdAt))
      : '';

  el.replaceChildren();
  el.removeAttribute('data-kind');
  if (status.kind === 'idle') return;
  el.setAttribute('data-kind', status.kind);
  if (status.kind === 'resolving') el.append(T.resolving);
  else if (status.kind === 'searching') el.append(T.searching(fmt.monthUtc.format(status.from * 1000)));
  else if (status.kind === 'rate') el.append(T.rate(fmt.clock.format(status.resumeAt)));
  else if (status.kind === 'end') el.append(s.tweets.length ? T.end(fmt.full.format(s.t0)) : T.none);
  else if (status.kind === 'error') renderError(s, el, status.error);
}

function renderError(s, el, error) {
  const kind = error && error.kind;
  // These kinds have their own explanation; anything else shows the raw message.
  const known = kind === 'incompatible' || kind === 'auth' || kind === 'unavailable';
  const detail = error && error.message ? ` (${error.message})` : '';
  el.append(known ? T[kind] : T.failed + detail);
  // Retrying cannot make an unavailable account available.
  if (kind !== 'unavailable') {
    el.append(h('button', { class: 'xo-retry', type: 'button', text: T.retry, onclick: () => actions.retry(s) }));
  }
}

// ---- Cards ----

// Adds cards to the end of the list, with a heading wherever a new month begins.
export function appendCards(s, tweets) {
  if (!tweets.length) return;
  const frag = document.createDocumentFragment();
  for (const t of tweets) {
    const d = new Date(t.createdAt);
    const key = d.getFullYear() * 12 + d.getMonth();
    if (key !== s.els.lastMonth) {
      s.els.lastMonth = key;
      frag.append(h('div', { class: 'xo-month', text: fmt.month.format(d) }));
    }
    frag.append(card(t));
  }
  s.els.list.append(frag);
}

// ---- Clicks ----

// One listener for the whole view. Links within X go through X's router instead of reloading
// the page; a click anywhere else on a card opens the post, as on X's own timeline.
function onRootClick(e) {
  if (e.defaultPrevented || e.button !== 0) return;
  const a = e.target.closest('a[href]');
  if (a) {
    // Leave new-tab clicks and external links to the browser.
    if (a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || a.origin !== location.origin) return;
    e.preventDefault();
    actions.navigate(a.pathname + a.search);
    return;
  }
  if (e.target.closest('video, button, input, label')) return;
  if (String(window.getSelection())) return; // the click ended a text selection
  const target = e.target.closest('[data-href]');
  if (!target) return;
  const to = target.getAttribute('data-href');
  if (e.metaKey || e.ctrlKey) window.open(to, '_blank', 'noopener');
  else actions.navigate(to);
}
