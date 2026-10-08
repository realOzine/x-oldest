// Normalisation: turns X's deeply nested API objects into the flat shapes the rest of the
// extension works with. These shapes are also what the cache stores, so nothing outside this file
// needs to know what X's responses look like.
//
//   user  { id, name, screenName, avatar, createdAt }
//   post  { id, createdAt, userId, user, segments, media, quoted, quoteMissing, replyTo, counts }
//
// Times are in milliseconds. Everything here is a pure function.
//
// Exports on window.__xoldest: normalize.{ user, timelineTweets }.
(() => {
  const E = window.__xoldest;
  if (!E || E.normalize) return;

  // ---- Users ----

  // X has been moving user fields from `legacy` to `core`/`avatar`; both layouts are accepted.
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

  // ---- Post text ----

  // The API escapes exactly these three characters in `full_text`.
  function decodeEntities(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  // Posts longer than 280 characters keep their complete text in a separate `note_tweet`.
  function noteOf(r) {
    return r.note_tweet && r.note_tweet.note_tweet_results && r.note_tweet.note_tweet_results.result;
  }

  // Lists the stretches of the text that are not plain text, ordered by position. Each mark covers
  // code points [s, e). A 'drop' mark is removed from the text: the link X appends for attached
  // media or for a quoted post, both of which are rendered as their own blocks instead.
  function collectMarks(lg, note, quotedId) {
    const ents = (note ? note.entity_set : lg.entities) || {};
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
    return marks.sort((a, b) => a.s - b.s);
  }

  // Appends `str` to `out` as text segments, turning bare URLs into links. Old posts carry no URL
  // entities, so this is the only way their links become clickable.
  function pushLinkified(out, str) {
    let pos = 0;
    for (const m of str.matchAll(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g)) {
      if (m.index > pos) out.push({ type: 'text', text: str.slice(pos, m.index) });
      out.push({ type: 'link', text: m[0].replace(/^https?:\/\//, ''), href: m[0] });
      pos = m.index + m[0].length;
    }
    if (pos < str.length) out.push({ type: 'text', text: str.slice(pos) });
  }

  // Removes whitespace left at the end, typically where a trailing link was dropped.
  function trimTrailingText(out) {
    while (out.length && out[out.length - 1].type === 'text') {
      const last = out[out.length - 1];
      last.text = last.text.replace(/\s+$/, '');
      if (last.text) break;
      out.pop();
    }
  }

  // Splits a post's text into segments: { type: 'text', text } or
  // { type: 'link' | 'mention' | 'hashtag' | 'cashtag', text, href }.
  // The UI builds one DOM node per segment, so post text is never interpreted as HTML.
  function buildSegments(r, quotedId) {
    const lg = r.legacy;
    const note = noteOf(r);
    // Entity indices count code points, not UTF-16 units, hence the array.
    const cps = Array.from((note ? note.text : lg.full_text) || '');
    // `display_text_range` excludes the leading @mentions of a reply and the trailing media link.
    const range = note ? [0, cps.length] : lg.display_text_range || [0, cps.length];
    const fix = note ? (s) => s : decodeEntities;

    const out = [];
    const pushText = (s, e) => {
      if (e > s) pushLinkified(out, fix(cps.slice(s, e).join('')));
    };
    let pos = range[0];
    const end = Math.min(range[1], cps.length);
    for (const m of collectMarks(lg, note, quotedId)) {
      if (m.s < pos || m.e > end) continue; // outside the displayed range, or overlapping
      pushText(pos, m.s);
      if (m.type !== 'drop') out.push({ type: m.type, text: m.text || cps.slice(m.s, m.e).join(''), href: m.href });
      pos = m.e;
    }
    pushText(pos, end);
    trimTrailingText(out);
    return out;
  }

  // ---- Posts ----

  function normMedia(lg) {
    const list = (lg.extended_entities && lg.extended_entities.media) || [];
    return list.map((m) => {
      const item = {
        type: m.type, // 'photo' | 'video' | 'animated_gif'
        url: m.media_url_https, // the photo, or the poster frame of a video
        w: (m.original_info && m.original_info.width) || 0,
        h: (m.original_info && m.original_info.height) || 0,
        alt: m.ext_alt_text || '',
      };
      if (m.video_info) {
        // The highest-bitrate MP4; the other variants are HLS playlists a <video> cannot play.
        const mp4 = (m.video_info.variants || [])
          .filter((v) => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        item.video = mp4 ? mp4.url : null;
      }
      return item;
    });
  }

  // Posts with a visibility notice arrive wrapped; tombstones and the like have no `legacy`.
  function unwrapTweet(r) {
    if (r && r.__typename === 'TweetWithVisibilityResults') r = r.tweet;
    return r && r.rest_id && r.legacy ? r : null;
  }

  // `depth` stops at one level: a quoted post's own quote is not followed.
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
      quoteMissing: !!quotedId && !quoted, // quotes something that is deleted or not visible
      replyTo: lg.in_reply_to_status_id_str ? lg.in_reply_to_screen_name || '' : null,
      counts: { replies: lg.reply_count, reposts: lg.retweet_count, likes: lg.favorite_count },
    };
  }

  // ---- Timelines ----

  // The path to `instructions` differs per operation and shifts over time, so it is searched for.
  function findInstructions(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 8) return null;
    if (Array.isArray(o.instructions)) return o.instructions;
    for (const k of Object.keys(o)) {
      const r = findInstructions(o[k], depth + 1);
      if (r) return r;
    }
    return null;
  }

  // The posts in a timeline response, in the order returned, or null if it is not a timeline.
  // Only entries named `tweet-…` are posts; the rest are cursors, modules and promotions.
  function timelineTweets(data) {
    const instructions = findInstructions(data);
    if (!instructions) return null;
    const tweets = [];
    for (const ins of instructions) {
      for (const entry of ins.entries || []) {
        if (!entry.entryId || !entry.entryId.startsWith('tweet-')) continue;
        const item = entry.content && entry.content.itemContent;
        const t = normTweet(item && item.tweet_results && item.tweet_results.result);
        if (t) tweets.push(t);
      }
    }
    return tweets;
  }

  E.normalize = { user: normUser, timelineTweets };
})();
