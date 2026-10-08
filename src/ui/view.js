// View: the reading view's DOM. A toolbar, the list of cards and a status line.
//
// The view draws a session (see app.js) and reports what the user did; it decides nothing itself.
//
// Cards are rendered lazily. A session can hold thousands of posts, and putting them all in the
// page at once freezes it. So the list only holds `s.tweets[first..last)`: it starts around the
// reading position and grows a chunk at a time, downwards as the end of the list nears the
// viewport and upwards as its start does.
//
// Its elements are kept on the session as `s.els`:
//   root, list, status       the container, the cards, the area below them
//   top                      marks the start of the list, to know when earlier cards are wanted
//   statusText               the line of text inside `status`, above the placeholder cards
//   earliest                 the note in the toolbar
//   observer                 watches `top` and `status` coming near the viewport
//   first, last              the range of `s.tweets` that is in the list
//   lastMonth                month of the last card in the list, to know when a heading is due
// What the user does is passed to the `actions` given to bind():
//   restart(s)         the cache is to be cleared
//   retry(s)           the retry button was pressed
//   nearEnd(s)         the end of the list came within reach of the viewport
//   navigate(url)      a link or card within X was clicked

import { card, h } from './cards.js';
import { T, fmt } from './i18n.js';

const PRELOAD_MARGIN = '2000px 0px'; // how far outside the viewport counts as "near"
const CHUNK = 30; // cards added to the list at a time
const LEAD = 5; // cards rendered above the reading position to begin with
const PLACEHOLDERS = 5; // ui.css shows fewer once the list has cards

let actions = null;

export function bind(handlers) {
  actions = handlers;
}

// ---- Mounting ----

// Makes sure the session's view exists inside `p.host`, building it if X has re-rendered the
// page and thrown the previous one away. Safe to call repeatedly. Returns true if it was built.
export function mount(s, p) {
  if (s.els && s.els.root.isConnected && s.els.root.parentElement === p.host) return false;
  document.querySelectorAll('#xo-root').forEach((el) => el.remove());
  if (s.els) s.els.observer.disconnect();

  const earliest = h('span', { class: 'xo-earliest' });

  const top = h('div', { class: 'xo-top' });
  const list = h('div', { class: 'xo-list' });
  const statusText = h('div', { class: 'xo-status-text' });
  // Built once and shown by ui.css while loading, so progress updates do not restart their animation.
  const status = h(
    'div',
    { class: 'xo-status' },
    statusText,
    h('div', { class: 'xo-skels', 'aria-hidden': 'true' }, Array.from({ length: PLACEHOLDERS }, placeholder)),
  );
  const root = h(
    'div',
    { id: 'xo-root' },
    h(
      'div',
      { class: 'xo-bar' },
      earliest,
      h('button', { class: 'xo-clear', type: 'button', text: T.clearCache, onclick: () => actions.restart(s) }),
    ),
    top,
    list,
    status,
  );
  root.addEventListener('click', onRootClick);

  // `top` sits above the first card and the status line below the last, so either of them
  // nearing the viewport means more cards are needed on that side.
  const observer = new IntersectionObserver(
    (entries) => {
      const near = new Map(entries.map((e) => [e.target, e.isIntersecting])); // latest state wins
      if (near.get(top)) showEarlier(s);
      if (near.has(status)) {
        s.near = near.get(status);
        if (s.near) actions.nearEnd(s);
      }
    },
    { rootMargin: PRELOAD_MARGIN },
  );
  observer.observe(top);
  observer.observe(status);

  s.els = { root, list, status, top, statusText, earliest, observer, first: 0, last: 0, lastMonth: null };
  p.host.append(root);
  reset(s);
  renderStatus(s);
  return true;
}

// ---- Status ----

// Draws `s.status` below the list, and the "earliest post" note in the toolbar.
//   idle       nothing to show
//   resolving  looking up the account
//   searching  fetching the window that starts at `from` (Unix seconds); `found` posts so far
//   rate       rate limited; loading resumes at `resumeAt` (ms)
//   end        the whole range has been read
//   error      `error` is the XoError
export function renderStatus(s) {
  if (!s.els) return;
  const { status: box, statusText: el, earliest } = s.els;
  const status = s.status;

  earliest.textContent = s.tweets.length ? T.earliest(fmt.day.format(s.tweets[0].createdAt)) : '';

  el.replaceChildren();
  box.removeAttribute('data-kind');
  box.toggleAttribute('data-busy', status.kind === 'resolving' || status.kind === 'searching');
  if (status.kind === 'idle') return;
  box.setAttribute('data-kind', status.kind);
  if (status.kind === 'resolving') el.append(T.resolving);
  else if (status.kind === 'searching') {
    el.append(status.found ? T.collecting(status.found) : T.searching(fmt.monthUtc.format(status.from * 1000)));
  }
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

// A grey outline of a card, standing in for posts that are still loading.
function placeholder() {
  return h(
    'div',
    { class: 'xo-skel' },
    h('div', { class: 'xo-skel-avatar' }),
    h('div', { class: 'xo-body' }, h('div', { class: 'xo-skel-line' }), h('div', { class: 'xo-skel-line' }), h('div', { class: 'xo-skel-line' })),
  );
}

// ---- Cards ----

const monthKey = (t) => {
  const d = new Date(t.createdAt);
  return d.getFullYear() * 12 + d.getMonth();
};

// Builds cards for `tweets`, with a heading wherever the month differs from `prevMonth`.
function buildCards(tweets, prevMonth, fresh) {
  const frag = document.createDocumentFragment();
  for (const t of tweets) {
    const key = monthKey(t);
    if (key !== prevMonth) {
      prevMonth = key;
      frag.append(h('div', { class: 'xo-month', text: fmt.month.format(t.createdAt) }));
    }
    const el = card(t);
    if (fresh) el.classList.add('xo-in');
    frag.append(el);
  }
  return frag;
}

// An observer only reports changes. Observing an element again makes it report the current
// state, so adding one chunk per report keeps going for as long as more is needed, without
// doing it all in one long task.
function recheck(s, el) {
  s.els.observer.unobserve(el);
  s.els.observer.observe(el);
}

// Empties the list and starts it again around the reading position (`s.anchor`), or at the
// first post if there is none.
export function reset(s) {
  const at = s.anchor ? s.tweets.findIndex((t) => t.id === s.anchor.id) : -1;
  s.els.list.replaceChildren();
  s.els.first = s.els.last = Math.max(0, at - LEAD);
  s.els.lastMonth = null;
  fill(s);
  recheck(s, s.els.top); // the list may now start mid-history, right below the viewport's reach
}

// Adds the next chunk of loaded posts to the end of the list. Returns false if every loaded
// post is already there. `fresh` cards have just been loaded and fade in.
export function fill(s, fresh) {
  if (!s.els || !s.els.root.isConnected || s.els.last >= s.tweets.length) return false;
  const chunk = s.tweets.slice(s.els.last, s.els.last + CHUNK);
  s.els.list.append(buildCards(chunk, s.els.lastMonth, fresh));
  s.els.last += chunk.length;
  s.els.lastMonth = monthKey(chunk[chunk.length - 1]);
  recheck(s, s.els.status);
  return true;
}

// Adds the previous chunk to the start of the list. The browser's scroll anchoring keeps what
// is on screen where it is while the list grows above it.
function showEarlier(s) {
  const { list, first } = s.els;
  if (first === 0) return;
  const chunk = s.tweets.slice(Math.max(0, first - CHUNK), first);
  // The list starts with a heading for its first card's month. If the cards going in above
  // end in that same month, the heading no longer marks where the month begins.
  const joins = first < s.tweets.length && monthKey(chunk[chunk.length - 1]) === monthKey(s.tweets[first]);
  if (joins && list.firstChild && list.firstChild.classList.contains('xo-month')) list.firstChild.remove();
  list.prepend(buildCards(chunk, null));
  s.els.first -= chunk.length;
  recheck(s, s.els.top);
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
