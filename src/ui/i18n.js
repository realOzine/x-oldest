// Interface text and date formats, in Chinese or English.

// Follow X's own display language rather than the browser's.
const lang = (document.documentElement.lang || navigator.language || 'en').toLowerCase();

export const T = lang.startsWith('zh')
  ? {
      tab: '最早',
      earliest: (d) => `目前找到的最早帖子：${d}`,
      clearCache: '清除缓存',
      resolving: '正在读取账号信息…',
      searching: (d) => `正在查找 ${d} 之后的帖子…`,
      collecting: (n) => `已找到 ${n} 条，正在补全这一时段…`,
      rate: (t) => `已达到 X 的搜索频率限制，将在 ${t} 自动继续`,
      end: (d) => `已读到本次查询范围的末尾（截至 ${d}）`,
      none: '该查询范围内未找到可获取的帖子',
      incompatible: '与当前 X 页面不兼容，请刷新页面后重试',
      auth: '请先在 X 正常登录后再试',
      unavailable: '当前无法获取该账号的历史帖子',
      failed: '加载失败',
      retry: '重试',
      replyingTo: (n) => `回复 @${n}`,
      quoteMissing: '引用内容暂不可用',
      mediaMissing: '在原帖中查看媒体',
      stats: (c) => `回复 ${c.replies} · 转帖 ${c.reposts} · 喜欢 ${c.likes}`,
    }
  : {
      tab: 'Oldest',
      earliest: (d) => `Earliest post found so far: ${d}`,
      clearCache: 'Clear cache',
      resolving: 'Loading account…',
      searching: (d) => `Looking for posts after ${d}…`,
      collecting: (n) => `Found ${n} posts so far, fetching the rest of this period…`,
      rate: (t) => `X's search rate limit was reached. Continuing automatically at ${t}`,
      end: (d) => `End of this search range (up to ${d})`,
      none: 'No retrievable posts were found in this range',
      incompatible: 'Not compatible with the current X page. Reload and try again',
      auth: 'Sign in to X first, then try again',
      unavailable: "This account's history cannot be retrieved right now",
      failed: 'Loading failed',
      retry: 'Retry',
      replyingTo: (n) => `Replying to @${n}`,
      quoteMissing: 'Quoted post unavailable',
      mediaMissing: 'View media in the original post',
      stats: (c) => `${c.replies} replies · ${c.reposts} reposts · ${c.likes} likes`,
    };

// All formatters take a time in milliseconds.
export const fmt = {
  day: new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric' }),
  month: new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long' }),
  // Search windows are UTC, so their labels are formatted in UTC too.
  monthUtc: new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', timeZone: 'UTC' }),
  full: new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }),
  clock: new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }),
};
