const { activityFromHistory } = require("./session-activity.cjs");
const {
  boundedHistoryEntries,
  historyImageBytes,
  historyRevision,
  hydrateHistoryImages,
  messagesFromHistory,
} = require("./history-model.cjs");

// A chat opens on its newest messages, and older ones load when the reader scrolls up to them.
// Every read used to walk the transcript back to its first message, 80 at a time: a chat of
// 6,000 messages took 5-7 s and some 130 MB of tool output from Harness on each open, most of
// it never on screen, and a refresh paid most of it again because no cache could hold it.
const HISTORY_TAIL_MESSAGES = 120;
// A chat already in the cache only needs what arrived since. A short page that does not reach
// the cached range means more happened than it holds, and a full tail read replaces it.
const HISTORY_REFRESH_MESSAGES = 24;
// Attachments never change, so a chat's image previews are fetched once rather than on every
// refresh of it, and every refresh of a running turn.
const ATTACHMENT_CACHE_BYTES = 24 * 1024 * 1024;

const seqOf = (entry) => (Number.isFinite(entry?.event?.seq) ? entry.event.seq : null);

function seqRange(entries) {
  let oldest = null;
  let newest = null;
  for (const entry of entries) {
    const seq = seqOf(entry);
    if (seq === null) continue;
    if (oldest === null || seq < oldest) oldest = seq;
    if (newest === null || seq > newest) newest = seq;
  }
  return { oldest, newest };
}

// Fresh sequenced events supersede their cached versions; unsequenced ones only come from the
// newest read, so a merge never repeats them.
function mergeEntries(older, newer) {
  const sequenced = new Map();
  const unsequenced = [];
  for (const entry of [...older, ...newer]) {
    const seq = seqOf(entry);
    if (seq === null) unsequenced.push(entry);
    else sequenced.set(seq, entry);
  }
  return [...sequenced.entries()].sort(([left], [right]) => left - right).map(([, entry]) => entry).concat(unsequenced);
}

function createAttachmentCache(limitBytes = ATTACHMENT_CACHE_BYTES) {
  const entries = new Map();
  let bytes = 0;
  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      entries.delete(key); entries.set(key, value);
      return value;
    },
    set(key, value) {
      const size = historyImageBytes(value);
      if (size < 1 || size > limitBytes) return;
      if (entries.has(key)) bytes -= historyImageBytes(entries.get(key));
      entries.delete(key); entries.set(key, value);
      bytes += size;
      while (bytes > limitBytes && entries.size) {
        const [oldestKey, oldestValue] = entries.entries().next().value;
        entries.delete(oldestKey);
        bytes -= historyImageBytes(oldestValue);
      }
    },
    clear() { entries.clear(); bytes = 0; },
    get size() { return entries.size; },
  };
}

// The cache keeps the whole range a chat has loaded: a refresh merges its short newest page onto
// it, and each older page extends it. Reads of one chat run one at a time, so a refresh that
// started before an older page landed cannot write back a range without it.
async function readHistory(api, sessionId, { older = false } = {}) {
  const key = String(sessionId || "");
  api.historyQueues ||= new Map();
  const previous = api.historyQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => readHistoryNow(api, sessionId, key, older));
  api.historyQueues.set(key, next);
  try { return await next; }
  finally { if (api.historyQueues.get(key) === next) api.historyQueues.delete(key); }
}

async function readHistoryNow(api, sessionId, key, older) {
  const remote = await api.ensureRemote();
  const cached = api.cachedHistory(key);
  const cachedEvents = cached?.events || [];
  let entries;
  let hasOlder;
  let throughSeq = cached?.throughSeq ?? null;
  if (older && cached) {
    const { oldest } = seqRange(cachedEvents);
    // A remote page is walked with the snapshot's cursor; without one there is nowhere to go.
    const canPage = cached.hasOlder && oldest !== null && (!remote || throughSeq !== null);
    if (!canPage) {
      entries = cachedEvents;
      hasOlder = false;
    } else {
      const page = await api.fetchHistoryPage(remote, sessionId, { maxMessages: HISTORY_TAIL_MESSAGES, beforeSeq: oldest, throughSeq });
      // Older pages give up their image previews: the newest messages own that budget.
      const earlier = boundedHistoryEntries(page.events || [], 0).filter((entry) => seqOf(entry) !== null && seqOf(entry) < oldest);
      entries = mergeEntries(earlier, cachedEvents);
      hasOlder = Boolean(page.hasMore) && earlier.length > 0;
    }
  } else {
    const warm = cachedEvents.length > 0;
    let page = await api.fetchHistoryPage(remote, sessionId, { maxMessages: warm ? HISTORY_REFRESH_MESSAGES : HISTORY_TAIL_MESSAGES });
    let fresh = boundedHistoryEntries(page.events || []);
    const reachesCache = (events) => {
      const { oldest } = seqRange(events);
      const { newest } = seqRange(cachedEvents);
      return oldest !== null && newest !== null && oldest <= newest;
    };
    if (warm && page.hasMore && fresh.length && !reachesCache(fresh)) {
      page = await api.fetchHistoryPage(remote, sessionId, { maxMessages: HISTORY_TAIL_MESSAGES });
      fresh = boundedHistoryEntries(page.events || []);
    }
    if (page.throughSeq !== undefined) throughSeq = page.throughSeq;
    if (!fresh.length && warm) {
      // A restarting or re-indexing Harness can answer with nothing for a chat that has a
      // conversation. That is a fault, not a compaction: keep what was there.
      entries = cachedEvents;
      hasOlder = Boolean(cached.hasOlder);
    } else if (!page.hasMore) {
      // The whole chat fits the page, which also carries a /compact shrinking it.
      entries = mergeEntries([], fresh);
      hasOlder = false;
    } else if (warm && reachesCache(fresh)) {
      const { oldest } = seqRange(fresh);
      entries = mergeEntries(cachedEvents.filter((entry) => seqOf(entry) !== null && seqOf(entry) < oldest), fresh);
      hasOlder = Boolean(cached.hasOlder);
    } else {
      entries = mergeEntries([], fresh);
      hasOlder = true;
    }
  }
  const hydrated = await hydrateHistoryImages(entries, (attachmentId) => readCachedAttachment(api, remote, sessionId, attachmentId));
  const events = boundedHistoryEntries(hydrated);
  const revision = historyRevision(events);
  api.cacheHistory(key, { events, revision, hasOlder, throughSeq });
  return {
    messages: messagesFromHistory(events),
    activity: activityFromHistory(events),
    revision,
    unchanged: cached?.revision === revision,
    hasOlder,
  };
}

async function readCachedAttachment(api, remote, sessionId, attachmentId) {
  api.attachmentCache ||= createAttachmentCache();
  const key = `${sessionId}\u0000${attachmentId}`;
  const known = api.attachmentCache.get(key);
  if (known !== undefined) return known;
  const value = remote ? await remote.call("session/attachment", { request: { sessionId, attachmentId } }, 10000)
    : await api.rpc("session.attachment", { sessionId, attachmentId }, 10000);
  const data = value?.data;
  if (historyImageBytes(data) > 0) api.attachmentCache.set(key, data);
  return data;
}

module.exports = {
  ATTACHMENT_CACHE_BYTES,
  HISTORY_REFRESH_MESSAGES,
  HISTORY_TAIL_MESSAGES,
  createAttachmentCache,
  mergeEntries,
  readHistory,
};
