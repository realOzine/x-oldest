// API: the two questions the UI asks of X, built from the transport, the normaliser and the reader.

import { XoError } from './errors.js';
import { normUser, timelineTweets } from './normalize.js';
import { PAGE_SIZE, Reader } from './reader.js';
import { gql } from './transport.js';

// Looks up an account by handle. Rejects with kind 'unavailable' if it does not exist or is
// suspended. Protected accounts are not rejected here: search works for the owner and approved
// followers, and simply finds nothing for everyone else.
export async function resolveUser(screenName) {
  const data = await gql('UserByScreenName', { screen_name: screenName, withGrokTranslatedBio: false });
  const result = data.user && data.user.result;
  const user = normUser(result);
  if (!user) throw new XoError('unavailable', (result && result.__typename) || 'user not found');
  return user;
}

// One page (newest first) of a user's own posts, replies excluded, with since <= time < until,
// in Unix seconds.
// `since_time`/`until_time` are used rather than `since`/`until`, whose day boundaries are not UTC.
async function searchWindow(user, since, until) {
  // since_time's boundary inclusiveness is not documented; overlap by a second and dedupe by id.
  const rawQuery = `from:${user.screenName} since_time:${since - 1} until_time:${until} -filter:replies`;
  const data = await gql('SearchTimeline', {
    rawQuery,
    count: PAGE_SIZE,
    querySource: 'typed_query',
    product: 'Latest', // chronological; the default ranks by relevance
    withGrokTranslatedBio: false,
    withQuickPromoteEligibilityTweetFields: false,
  });
  const tweets = timelineTweets(data);
  if (!tweets) throw new XoError('parse', 'timeline instructions not found');
  // Search results can include other people's posts; keep only this author's.
  return tweets.filter((t) => t.userId === user.id && !Number.isNaN(t.createdAt));
}

// A Reader over one user's posts. `options` are the Reader's.
export function openReader(user, options) {
  return new Reader((since, until) => searchWindow(user, since, until), options);
}
