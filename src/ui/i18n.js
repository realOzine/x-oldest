// Interface text and date formats, in Chinese or English.
//
// Exports on window.__xoldest.ui: T (strings), fmt (date formatters).
(() => {
  const E = window.__xoldest;
  if (!E || E.ui) return;

  // Follow X's own display language rather than the browser's.
  const lang = (document.documentElement.lang || navigator.language || 'en').toLowerCase();

  const T = lang.startsWith('zh')
    ? {
        tab: '最早',
        earliest: (d) => `目前找到的最早帖子：${d}`,
        fromDate: (d) => `从 ${d} 开始阅读，此前的时间段尚未查询`,
        withReplies: '包含回复',
        clearCache: '清除缓存',
        startFrom: '起始月份',
        resolving: '正在读取账号信息…',
        searching: (d) => `正在查找 ${d} 之后的帖子…`,
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
        fromDate: (d) => `Reading from ${d}; earlier periods have not been searched`,
        withReplies: 'Include replies',
        clearCache: 'Clear cache',
        startFrom: 'Start month',
        resolving: 'Loading account…',
        searching: (d) => `Looking for posts after ${d}…`,
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
  const fmt = {
    day: new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric' }),
    month: new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long' }),
    // Search windows and the start month are UTC, so their labels are formatted in UTC too.
    monthUtc: new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long', timeZone: 'UTC' }),
    full: new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }),
    clock: new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }),
  };

  E.ui = { T, fmt };
})();
