// API: the two questions the UI asks of X, built from the transport, the normaliser and the reader.
//
// Exports on window.__xoldest: resolveUser(screenName), openReader(user, options).
(() => {
  const E = window.__xoldest;
  if (!E || E.openReader) return;

  const { XoError, gql, normalize, Reader } = E;

  // Looks up an account by handle. Rejects with kind 'unavailable' if it does not exist or is
  // suspended. Protected accounts are not rejected here: search works for the owner and approved
  // followers, and simply finds nothing for everyone else.
  async function resolveUser(screenName) {
    const data = await gql('UserByScreenName', { screen_name: screenName, withGrokTranslatedBio: false });
    const result = data.user && data.user.result;
    const user = normalize.user(result);
    if (!user) throw new XoError('unavailable', (result && result.__typename) || 'user not found');
    return user;
  }

  // One page (newest first) of a user's posts with since <= time < until, in Unix seconds.
  // `since_time`/`until_time` are used rather than `since`/`until`, whose day boundaries are not UTC.
  async function searchWindow(user, since, until, withReplies) {
    // since_time's boundary inclusiveness is not documented; overlap by a second and dedupe by id.
    const rawQuery =
      `from:${user.screenName} since_time:${since - 1} until_time:${until}` + (withReplies ? '' : ' -filter:replies');
    const data = await gql('SearchTimeline', {
      rawQuery,
      count: Reader.PAGE_SIZE,
      querySource: 'typed_query',
      product: 'Latest', // chronological; the default ranks by relevance
      withGrokTranslatedBio: false,
      withQuickPromoteEligibilityTweetFields: false,
    });
    const tweets = normalize.timelineTweets(data);
    if (!tweets) throw new XoError('parse', 'timeline instructions not found');
    // Search results can include other people's posts; keep only this author's.
    return tweets.filter((t) => t.userId === user.id && !Number.isNaN(t.createdAt));
  }

  // A Reader over one user's posts. `options` are the Reader's, plus `withReplies`.
  function openReader(user, { withReplies, ...options }) {
    return new Reader((since, until) => searchWindow(user, since, until, !!withReplies), options);
  }

  E.resolveUser = resolveUser;
  E.openReader = openReader;
})();
