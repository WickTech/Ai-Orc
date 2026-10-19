// Advisor follow-ups (A20, AC-53, AC-54).

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CATEGORIES = new Set(['blocker', 'outperforming', 'degrading']);
const STATUSES = new Set(['OPEN', 'DONE', 'DROPPED']);

/**
 * @param {string} s
 * @returns {string}
 */
export function normalizeAction(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
}

function utcMidnight(y, m, d) {
  return Date.UTC(y, m - 1, d);
}

/**
 * @param {string} dateStr
 * @returns {number|null} UTC-midnight epoch ms, or null if invalid
 */
function parseDateStrict(dateStr) {
  const match = DATE_RE.exec(dateStr);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const ms = utcMidnight(y, m, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

/**
 * @param {string} text
 * @param {Date} now
 * @returns {{ open: Array<{date:string, rank:number, category:string, action:string, ageDays:number}>, malformed: number }}
 */
export function parseRecommendationsLog(text, now) {
  const todayMs = utcMidnight(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
  const lines = String(text).split(/\r?\n/);
  let malformed = 0;
  /** @type {Array<{date:string, dateMs:number, rank:number, category:string, action:string, status:string, lineIndex:number}>} */
  const valid = [];

  lines.forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) return;

    const fields = line.split('|').map((f) => f.trim());
    if (fields.length !== 5) {
      malformed += 1;
      return;
    }
    const [dateStr, rankStr, category, action, status] = fields;
    const dateMs = parseDateStrict(dateStr);
    const rank = Number(rankStr);
    const rankOk = /^[1-9]\d*$/.test(rankStr) && rank >= 1 && rank <= 3;

    if (
      dateMs === null ||
      dateMs > todayMs ||
      !rankOk ||
      !CATEGORIES.has(category) ||
      action === '' ||
      !STATUSES.has(status)
    ) {
      malformed += 1;
      return;
    }

    valid.push({ date: dateStr, dateMs, rank, category, action, status, lineIndex });
  });

  // Group by normalised action; the latest line (by date, then by later
  // position in the file) wins.
  const groups = new Map();
  for (const entry of valid) {
    const key = normalizeAction(entry.action);
    const current = groups.get(key);
    if (
      !current ||
      entry.dateMs > current.dateMs ||
      (entry.dateMs === current.dateMs && entry.lineIndex > current.lineIndex)
    ) {
      groups.set(key, entry);
    }
  }

  const open = [];
  for (const entry of groups.values()) {
    if (entry.status !== 'OPEN') continue;
    const ageDays = Math.round((todayMs - entry.dateMs) / 86400000);
    if (ageDays < 1 || ageDays > 7) continue;
    open.push({ date: entry.date, rank: entry.rank, category: entry.category, action: entry.action, ageDays });
  }

  open.sort((a, b) => b.ageDays - a.ageDays);

  return { open, malformed };
}

/**
 * @param {Array<{date:string, rank:number, category:string, action:string, ageDays:number}>} open
 * @param {string[]} todaysActions
 * @returns {Array<{date:string, action:string, ageDays:number}>}
 */
export function selectFollowUps(open, todaysActions) {
  const todaySet = new Set((todaysActions || []).map(normalizeAction));
  const filtered = open
    .filter((item) => !todaySet.has(normalizeAction(item.action)))
    .map((item) => ({ date: item.date, action: item.action, ageDays: item.ageDays }));
  return filtered.slice(0, 10);
}
