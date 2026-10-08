// Reader: walks a user's history forward in time, oldest first.
//
// The difficulty is that search only answers "the newest posts before time T". Asking for more
// with X's paging cursor does not help either: deep paging silently drops the oldest results.
// So the reader never pages. It works one time window at a time:
//
//        cursor                        cursor + span
//          |<---------- window ---------->|
//          |    <- page 3 <- page 2 <- page 1      each page: the newest posts before `until`
//
//   1. fetch the newest page of the window;
//   2. move `until` back to the oldest post just received and fetch again, until a page comes
//      back short, which means the start of the window has been reached;
//   3. hand the whole window over in ascending order and move the cursor to the window's end.
//
// The window size adapts: it grows across quiet periods and shrinks in busy ones, so a batch is
// neither a long wait nor a single post.
//
// The reader knows nothing about X. It is given a `fetchPage(since, until)` function that resolves
// to posts ({ id, createdAt }) with since <= time < until, newest first, at most one page.
// All times here are Unix seconds, except a post's `createdAt`, which is in milliseconds.

import { XoError } from './errors.js';

const DAY = 86400;
export const PAGE_SIZE = 20; // posts requested per page
// Pages with more to come sometimes arrive a post or two short, so "full" is slightly less.
const FULL_PAGE = PAGE_SIZE - 2;
const DEFAULT_SPAN = 30 * DAY;
const MIN_SPAN = 3600;
const MAX_SPAN = 365 * DAY;
const SPARSE_WINDOW = 8; // a window with fewer posts than this makes the next one larger

const sec = (t) => Math.floor(t.createdAt / 1000);
const oldestSec = (tweets) => Math.min(...tweets.map(sec));

// Reading order. Ids are compared as BigInt: they exceed what a Number holds exactly.
function byTimeThenId(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  const x = BigInt(a.id);
  const y = BigInt(b.id);
  return x < y ? -1 : x > y ? 1 : 0;
}

export class Reader {
  // Reads from `start` to `end`. `span` and `seenIds` carry on from an earlier session, in
  // which case `start` is that session's saved cursor.
  constructor(fetchPage, { start, end, span, seenIds }) {
    this.fetchPage = fetchPage;
    this.cursor = start; // everything before this has been read; persisted to resume later
    this.end = end;
    this.span = span || DEFAULT_SPAN; // size of the next window; persisted as well
    this.seen = new Set(seenIds); // ids already handed out, since windows overlap by a second
    this.pending = null; // the window being fetched: { a, b, got, until, complete }
    this.cancelled = false;
  }

  get done() {
    return this.cursor >= this.end;
  }

  // Makes every current and future call reject with kind 'cancelled'.
  cancel() {
    this.cancelled = true;
  }

  async page(since, until) {
    if (this.cancelled) throw new XoError('cancelled');
    const tweets = await this.fetchPage(since, until);
    if (this.cancelled) throw new XoError('cancelled');
    return tweets;
  }

  // Resolves to the next non-empty batch in ascending order, or to [] once `end` is reached.
  // `onProgress({ from, to, found })` is called before each request. `found` is the number of
  // posts collected so far in the window, and is absent while the window is being opened.
  //
  // If a request fails this rejects, and the reader stays where it was: `pending` keeps the
  // pages already fetched, so calling next() again resumes the window instead of restarting it.
  async next(onProgress) {
    while (!this.done) {
      if (!this.pending) this.pending = await this.openWindow(onProgress);
      if (!this.pending) continue; // the window was empty or got resized; try the next one
      await this.fillWindow(this.pending, onProgress);
      const batch = this.closeWindow(this.pending);
      this.pending = null;
      if (batch.length) return batch;
    }
    return [];
  }

  // Fetches the newest page of the window at the cursor. Returns the window to fill, or null
  // after adjusting the cursor or the span, in which case the caller starts over.
  async openWindow(onProgress) {
    const a = this.cursor;
    const b = Math.min(a + this.span, this.end);
    if (onProgress) onProgress({ from: a, to: b });
    const first = await this.page(a, b);

    // Nothing here: skip the window and look further ahead next time.
    if (!first.length) {
      this.cursor = b;
      this.span = Math.min(this.span * 2, MAX_SPAN);
      return null;
    }

    // A full page that only reaches back a small part of the window means the window holds
    // many pages. Shrink it so the first screen does not wait for all of them.
    const oldest = oldestSec(first);
    const covered = b - oldest;
    if (first.length >= FULL_PAGE && this.span > MIN_SPAN && covered < (b - a) / 2) {
      this.span = Math.max(MIN_SPAN, Math.min(covered * 2, Math.floor(this.span / 2)));
      return null;
    }

    return {
      a,
      b,
      got: new Map(first.map((t) => [t.id, t])),
      until: oldest + 1, // + 1 so posts sharing the oldest second are fetched again, not skipped
      complete: first.length < FULL_PAGE,
    };
  }

  // Walks `until` back to the start of the window, collecting pages into `w.got`.
  // A short page is taken as the start of the window. That saves one request per window and
  // can occasionally miss posts, which is the accepted trade for speed.
  async fillWindow(w, onProgress) {
    while (!w.complete) {
      if (onProgress) onProgress({ from: w.a, to: w.b, found: w.got.size });
      const page = await this.page(w.a, w.until);
      const more = page.filter((t) => !w.got.has(t.id));
      more.forEach((t) => w.got.set(t.id, t));
      const nextUntil = more.length ? oldestSec(more) + 1 : w.until;
      // No progress means more than a page of posts within one second; give up on the rest.
      if (page.length < FULL_PAGE || nextUntil >= w.until) w.complete = true;
      w.until = nextUntil;
    }
  }

  // Turns a filled window into a batch and moves the cursor past it.
  closeWindow(w) {
    const batch = [...w.got.values()].filter((t) => !this.seen.has(t.id)).sort(byTimeThenId);
    batch.forEach((t) => this.seen.add(t.id));
    this.cursor = w.b;
    if (w.got.size < SPARSE_WINDOW) this.span = Math.min(this.span * 2, MAX_SPAN);
    return batch;
  }
}
