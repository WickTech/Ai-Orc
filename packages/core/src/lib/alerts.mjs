// Threshold + percent-change alerts (A21, AC-58).

import { TOTAL_KEYS } from './metric.mjs';

export const DEFAULT_THRESHOLDS = { metricChangePct: 20, failingCI: 0, vercelErrors: 0 };

const PERCENT_SECTIONS = ['github', 'vercel', 'gmail', 'supabase'];

/**
 * Merges a (possibly partial, possibly malformed) thresholds config over
 * the defaults, per key. A key is only overridden when its value is a
 * finite number (review round 2 MINOR #10): `null`, a string, `NaN` or
 * `Infinity` are ignored and the default is kept, so a config typo can
 * never turn a threshold comparison into `value > null` / a message like
 * "threshold >null".
 * @param {object} [overrides]
 * @returns {{metricChangePct:number, failingCI:number, vercelErrors:number}}
 */
export function mergeThresholds(overrides) {
  const merged = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
    const value = overrides && overrides[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      merged[key] = value;
    }
  }
  return merged;
}

function utcDateMs(isoOrDate) {
  const d = new Date(isoOrDate);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function formatPct(pct) {
  const rounded = Math.round(pct);
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

/**
 * Build the history snapshot for today's build.
 * @param {object} doc mission-control document
 * @returns {{date:string, generatedAt:string, metrics: Record<string,{value:number|null,status:string}>}}
 */
export function toSnapshot(doc) {
  const date = new Date(doc.generatedAt).toISOString().slice(0, 10);
  const metrics = {};
  for (const section of PERCENT_SECTIONS) {
    const sec = doc[section];
    for (const key of TOTAL_KEYS[section]) {
      const metric = sec && sec.totals && sec.totals[key];
      metrics[`${section}.totals.${key}`] = metric
        ? { value: metric.value, status: metric.status }
        : { value: null, status: 'UNAVAILABLE' };
    }
  }
  return { date, generatedAt: doc.generatedAt, metrics };
}

/**
 * @param {object} doc mission-control document
 * @param {Array<{date:string, generatedAt:string, metrics:Record<string,{value:number|null,status:string}>}>} history
 * @param {{metricChangePct:number, failingCI:number, vercelErrors:number}} [thresholds]
 * @returns {Array<{metric:string, message:string, severity:'critical'|'warning', source:string, asOf:string}>}
 */
export function computeAlerts(doc, history, thresholds) {
  // Merge per key, never replace wholesale (review IMPORTANT #6), and only
  // accept finite numbers per key (review round 2 MINOR #10) — a config
  // that only sets one threshold key, or sets one to `null`/a string, must
  // not silently disable or corrupt the other alert rules.
  const t = mergeThresholds(thresholds);
  const alerts = [];
  const genDateMs = utcDateMs(doc.generatedAt);

  // Threshold criticals
  const failingCI = doc.github && doc.github.totals && doc.github.totals.failingCI;
  if (failingCI && failingCI.status === 'OK' && failingCI.value > t.failingCI) {
    alerts.push({
      metric: 'github.totals.failingCI',
      message: `Failing CI: ${failingCI.value} (threshold >${t.failingCI})`,
      severity: 'critical',
      source: failingCI.source,
      asOf: failingCI.asOf,
    });
  }
  const failed24h = doc.vercel && doc.vercel.totals && doc.vercel.totals.failed24h;
  if (failed24h && failed24h.status === 'OK' && failed24h.value > t.vercelErrors) {
    alerts.push({
      metric: 'vercel.totals.failed24h',
      message: `Vercel failed deploys 24h: ${failed24h.value} (threshold >${t.vercelErrors})`,
      severity: 'critical',
      source: failed24h.source,
      asOf: failed24h.asOf,
    });
  }

  // Percent-change warnings, section order then totals-key order.
  const windowSnapshots = (history || []).filter((snap) => {
    if (!snap || typeof snap.date !== 'string') return false;
    const snapMs = utcDateMs(snap.date);
    const diffDays = (genDateMs - snapMs) / 86400000;
    return diffDays >= 1 && diffDays <= 7;
  });

  for (const section of PERCENT_SECTIONS) {
    for (const key of TOTAL_KEYS[section]) {
      const metricRef = `${section}.totals.${key}`;
      const current = doc[section] && doc[section].totals && doc[section].totals[key];
      if (!current || current.status !== 'OK') continue;

      const values = [];
      for (const snap of windowSnapshots) {
        const m = snap.metrics && snap.metrics[metricRef];
        if (m && m.status === 'OK' && typeof m.value === 'number') {
          values.push(m.value);
        }
      }
      if (values.length === 0) continue;
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      if (!(avg > 0)) continue;

      const pct = ((current.value - avg) / avg) * 100;
      if (Math.abs(pct) >= t.metricChangePct) {
        alerts.push({
          metric: metricRef,
          message: `${metricRef} changed ${formatPct(pct)}% vs 7-day average ${avg.toFixed(1)} (${values.length} snapshots)`,
          severity: 'warning',
          source: 'axion:build-data (data/history)',
          asOf: current.asOf,
        });
      }
    }
  }

  return alerts;
}
