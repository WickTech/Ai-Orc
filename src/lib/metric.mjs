// Metric helpers shared by collectors, the merge step and the schema.
//
// A Metric is: { value: number|null, status: "OK"|"UNAVAILABLE", source, asOf, reason: null|string }

/**
 * @param {number} value
 * @param {string} source
 * @param {string} asOf
 * @returns {{value:number, status:'OK', source:string, asOf:string, reason:null}}
 */
export function ok(value, source, asOf) {
  return { value, status: 'OK', source, asOf, reason: null };
}

/**
 * @param {string} reason
 * @param {string} source
 * @param {string} asOf
 * @returns {{value:null, status:'UNAVAILABLE', source:string, asOf:string, reason:string}}
 */
export function unavailable(reason, source, asOf) {
  return { value: null, status: 'UNAVAILABLE', source, asOf, reason };
}

export const TOTAL_KEYS = {
  github: ['reposTracked', 'commits7d', 'openPRs', 'openIssues', 'failingCI'],
  vercel: ['projects', 'deploys24h', 'failed24h'],
  gmail: ['unread', 'importantUnread'],
  supabase: ['projects', 'securityAdvisors', 'performanceAdvisors'],
  orchestrator: ['steps', 'auto', 'approved', 'denied', 'skipped', 'failed'],
};

const LIST_KEYS = {
  github: 'repos',
  vercel: 'projects',
  gmail: 'topThreads',
  supabase: 'projects',
};

/**
 * Build a schema-valid UNAVAILABLE section for one of the "totals + list"
 * sections, or for advisor/research/orchestrator (which have their own
 * shapes handled here too).
 * @param {'github'|'vercel'|'gmail'|'supabase'|'advisor'|'research'|'orchestrator'} name
 * @param {string} reason
 * @param {string} source
 * @param {string} asOf
 */
export function unavailableSection(name, reason, source, asOf) {
  const base = { status: 'UNAVAILABLE', source, asOf, reason };

  if (name === 'advisor') {
    return { ...base, recommendations: [], followUps: [] };
  }
  if (name === 'research') {
    return {
      ...base,
      topic: null,
      slug: null,
      generatedAt: null,
      summary: null,
      sourceCount: unavailable(reason, source, asOf),
    };
  }
  if (name === 'orchestrator') {
    const totals = {};
    for (const key of TOTAL_KEYS.orchestrator) {
      totals[key] = unavailable(reason, source, asOf);
    }
    return { ...base, lastRun: null, totals };
  }

  // github, vercel, gmail, supabase
  const totals = {};
  for (const key of TOTAL_KEYS[name]) {
    totals[key] = unavailable(reason, source, asOf);
  }
  return { ...base, totals, [LIST_KEYS[name]]: [] };
}
