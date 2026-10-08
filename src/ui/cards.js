// Post cards: builds the DOM for one normalised post (see engine/normalize.js for its shape).
//
// Cards only display and link. Likes, replies and reposts are left to X's own post page, so there
// are no buttons here that look live but do nothing. Clicks are not handled per card either:
// elements that should navigate carry an `href` or a `data-href`, and view.js handles them all
// with one listener.
//
// Exports on window.__xoldest.ui: h (DOM helper), card(post).
(() => {
  const E = window.__xoldest;
  if (!E || !E.ui || E.ui.card) return;

  const { T, fmt } = E.ui;

  // Creates an element. `attrs` are set as attributes, except `class`, `text` (textContent) and
  // `on…` (event listeners); null and false are skipped, true makes an empty attribute.
  // Children may be nodes, strings, arrays of those, or null.
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

  // X resolves /i/status/<id> for any post, which covers a post whose author is unknown.
  const statusPath = (t) => `/${t.user ? t.user.screenName : 'i'}/status/${t.id}`;

  function header(t) {
    const u = t.user || { name: '', screenName: '' };
    return h(
      'div',
      { class: 'xo-head' },
      h('a', { class: 'xo-name', href: '/' + u.screenName, text: u.name }),
      h('span', { class: 'xo-handle', text: '@' + u.screenName }),
      h('span', { class: 'xo-dot', text: '·' }),
      h('a', { class: 'xo-time', href: statusPath(t), title: fmt.full.format(t.createdAt), text: fmt.day.format(t.createdAt) }),
    );
  }

  // One text node or link per segment; post text never goes through innerHTML.
  function textBlock(t) {
    if (!t.segments.length) return null;
    return h(
      'div',
      { class: 'xo-text', dir: 'auto' },
      t.segments.map((seg) => {
        if (seg.type === 'text') return document.createTextNode(seg.text);
        const external = seg.type === 'link'; // mentions, hashtags and cashtags stay within X
        return h('a', {
          href: seg.href,
          text: seg.text,
          target: external ? '_blank' : null,
          rel: external ? 'noopener noreferrer' : null,
        });
      }),
    );
  }

  // A leading video or GIF is shown on its own; otherwise up to four photos form a grid.
  function mediaBlock(t) {
    if (!t.media.length) return null;
    const first = t.media[0];
    if (first.type !== 'photo') return videoBlock(t, first);

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
          // Opens X's own photo viewer. X numbers the slots across all media, including videos.
          'data-href': `${statusPath(t)}/photo/${t.media.indexOf(m) + 1}`,
        });
        // Reserving the height up front keeps the list from jumping as images load.
        if (photos.length === 1 && m.w && m.h) img.style.aspectRatio = `${m.w} / ${m.h}`;
        return img;
      }),
    );
  }

  function videoBlock(t, m) {
    if (!m.video) return h('a', { class: 'xo-placeholder', href: statusPath(t), text: T.mediaMissing });
    const gif = m.type === 'animated_gif';
    const video = h('video', {
      class: 'xo-video',
      src: m.video,
      poster: m.url,
      preload: 'none', // nothing is downloaded until the user presses play
      controls: true,
      playsinline: true,
      loop: gif,
    });
    if (gif) video.muted = true;
    if (m.w && m.h) video.style.aspectRatio = `${m.w} / ${m.h}`;
    return h('div', { class: 'xo-media', 'data-n': '1' }, video);
  }

  function quoteBlock(t) {
    if (t.quoted) {
      const q = t.quoted;
      const avatar = q.user && q.user.avatar ? h('img', { class: 'xo-qavatar', src: q.user.avatar, alt: '' }) : null;
      return h(
        'div',
        { class: 'xo-quote', 'data-href': statusPath(q) },
        h('div', { class: 'xo-qhead' }, avatar, header(q)),
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
        // A snapshot from when the post was loaded, hence plain text rather than live buttons.
        h('div', { class: 'xo-stats', text: T.stats(t.counts) }),
      ),
    );
  }

  E.ui.h = h;
  E.ui.card = card;
})();
