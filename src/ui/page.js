// Page: everything that reads X's own page. Where are we, where can we attach, what colours is X
// using? X's class names are generated and change with every release, so elements are found by
// `data-testid`, ARIA roles and structure only.

import { T } from './i18n.js';

// ---- Routes ----

// First path segments that are X's own pages rather than a user's handle.
const RESERVED = new Set(['home', 'explore', 'search', 'notifications', 'messages', 'i', 'settings', 'compose', 'jobs', 'hashtag']);

const path = () => location.pathname.replace(/\/+$/, '').toLowerCase();

// X's compose and other dialogs get their own URL while the page underneath stays put.
export const isOverlayRoute = () => /^\/(compose|intent)\//.test(path());

export const isPostRoute = () => /^\/\w+\/status\//.test(path());

// The profile's main tab (/handle), as opposed to /handle/with_replies, /handle/media and so on.
export const onProfileRoot = (key) => path() === '/' + key;

// ---- Profile detection ----

// Describes the profile page currently shown, or returns null:
//   sn       the handle as X writes it
//   key      the handle in lower case; identifies the profile everywhere in the UI and the cache
//   tablist  X's Posts / Replies / Media tab bar
//   host     the element that holds X's timeline, where the reading view is added
export function findProfile() {
  const pc = document.querySelector('[data-testid="primaryColumn"]');
  if (!pc || !pc.querySelector('[data-testid="UserName"]')) return null;
  const tablist = pc.querySelector('nav [role="tablist"]');
  const first = tablist && tablist.querySelector('a[role="tab"]');
  if (!first) return null;
  // The first tab links to the profile itself, which gives the handle in its proper case.
  const sn = first.pathname.slice(1);
  if (!/^\w{1,15}$/.test(sn) || RESERVED.has(sn.toLowerCase())) return null;
  // During a route change the old profile's DOM can outlive its URL for a moment.
  if (path().split('/')[1] !== sn.toLowerCase()) return null;
  const nav = tablist.closest('nav');
  const section = pc.querySelector('section[role="region"]');
  const host = section ? section.parentElement : nav.parentElement && nav.parentElement.parentElement;
  if (!host) return null;
  return { sn, key: sn.toLowerCase(), tablist, host };
}

// ---- Theme ----

// The underline of X's currently selected native tab: a childless div, 4px high.
export function findIndicator(tablist) {
  const sel = tablist.querySelector('a[aria-selected="true"]:not([data-xo-a])');
  if (!sel) return null;
  return [...sel.querySelectorAll('div')].find((d) => d.childElementCount === 0 && getComputedStyle(d).height === '4px') || null;
}

// X has three themes (light, dim, black) and a user-chosen accent colour. Both are read off the
// page and published as CSS variables for ui.css.
export function applyTheme(tablist) {
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

// ---- Tab ----

// Builds our tab by cloning one of X's unselected tabs, so it inherits X's fonts, spacing and
// hover styles. The link inside is marked `data-xo-a`. Returns null if there is nothing to clone.
export function createTab(p) {
  const template = [...p.tablist.children].reverse().find((c) => c.querySelector('a[role="tab"][aria-selected="false"]'));
  if (!template) return null;
  const item = template.cloneNode(true);
  item.setAttribute('data-xo-tab', '');
  const a = item.querySelector('a[role="tab"]');
  a.setAttribute('data-xo-a', '');
  a.setAttribute('href', '/' + p.sn);
  a.removeAttribute('tabindex');
  const label = [...a.querySelectorAll('span')].find((s) => s.childElementCount === 0 && s.textContent.trim());
  if (label) label.textContent = T.tab;
  else a.textContent = T.tab;
  return item;
}
