// Local cache of loaded posts and reading progress, one record set per profile.
// It lives in IndexedDB on the x.com origin and holds post content only: no request headers,
// cookies or tokens. If IndexedDB is unavailable every call resolves to "nothing cached".
//
// Exports on window.__xoldest: store.{ load, write, clear }.
(() => {
  const E = window.__xoldest;
  if (!E || E.store) return;

  const DB_NAME = 'x-oldest';
  const SESSIONS = 'sessions'; // key -> progress and reading position
  const TWEETS = 'tweets'; // [key, seq] -> post, seq being its position in reading order

  let dbPromise = null;
  let queue = Promise.resolve();

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(SESSIONS, { keyPath: 'key' });
          req.result.createObjectStore(TWEETS, { keyPath: ['key', 'seq'] });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  const range = (key) => IDBKeyRange.bound([key, 0], [key, Infinity]);

  // Runs `fn` in one transaction. Operations are serialised so a clear issued before an append
  // always lands first.
  function run(mode, fn, fallback) {
    const result = queue.then(async () => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction([SESSIONS, TWEETS], mode);
        let value;
        tx.oncomplete = () => resolve(value);
        tx.onerror = tx.onabort = () => reject(tx.error);
        fn(tx.objectStore(SESSIONS), tx.objectStore(TWEETS), (v) => { value = v; });
      });
    });
    queue = result.catch(() => {});
    return result.catch((e) => {
      console.warn('[x-oldest] cache unavailable', e);
      return fallback;
    });
  }

  E.store = {
    // Resolves to { meta, tweets } or null.
    load(key) {
      return run(
        'readonly',
        (sessions, tweets, done) => {
          const out = {};
          sessions.get(key).onsuccess = (e) => { out.meta = e.target.result; };
          tweets.getAll(range(key)).onsuccess = (e) => {
            out.tweets = e.target.result.map((row) => row.tweet);
            done(out.meta ? out : null);
          };
        },
        null,
      );
    },

    // Posts and the progress that produced them are written together, so a reload never sees
    // progress that is ahead of the stored posts.
    // `expectedRev` is the revision this tab last read or wrote (null for "no record"). If the
    // stored one differs, another tab has cleared or rewritten the cache, and nothing is written.
    // Resolves to false when the write did not happen. `batch` may be empty.
    write(meta, batch, firstSeq, expectedRev) {
      return run(
        'readwrite',
        (sessions, tweets, done) => {
          sessions.get(meta.key).onsuccess = (e) => {
            const current = e.target.result;
            if (((current && current.rev) || null) !== expectedRev) {
              done(false);
              return;
            }
            batch.forEach((tweet, i) => tweets.put({ key: meta.key, seq: firstSeq + i, tweet }));
            sessions.put(meta);
            done(true);
          };
        },
        false,
      );
    },

    clear(key) {
      return run('readwrite', (sessions, tweets) => {
        sessions.delete(key);
        tweets.delete(range(key));
      });
    },
  };
})();
