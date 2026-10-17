// Hand-written, zero-dependency validator for the mission-control document
// (A1). Every error string starts with a dotted path.

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const METRIC_REF_RE = /^(github|vercel|gmail|supabase)\.totals\.[A-Za-z0-9]+$/;

const CI_VALUES = new Set(['success', 'failure', 'in_progress', 'none', 'other', 'UNAVAILABLE']);
const VERCEL_STATES = new Set(['READY', 'ERROR', 'BUILDING', 'QUEUED', 'CANCELED', 'UNAVAILABLE']);
const CATEGORY_PRIORITY = { blocker: 0, outperforming: 1, degrading: 2, routine: 3, unavailable: 4 };
const ROUTINE_ACTION = 'Routine day — no priority change';

const TOTAL_KEYS = {
  github: ['reposTracked', 'commits7d', 'openPRs', 'openIssues', 'failingCI'],
  vercel: ['projects', 'deploys24h', 'failed24h'],
  gmail: ['unread', 'importantUnread'],
  supabase: ['projects', 'securityAdvisors', 'performanceAdvisors'],
  orchestrator: ['steps', 'auto', 'approved', 'denied', 'skipped', 'failed'],
};

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isIsoUtc(s) {
  return typeof s === 'string' && ISO_UTC_RE.test(s) && !Number.isNaN(Date.parse(s));
}

function isDateStr(s) {
  return typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s));
}

function isNonEmptyString(s) {
  return typeof s === 'string' && s.length > 0;
}

function isNonNegInt(v) {
  return Number.isInteger(v) && v >= 0;
}

/**
 * @param {unknown} m
 * @param {string} path
 * @returns {string[]}
 */
export function validateMetric(m, path) {
  const errors = [];
  if (!isPlainObject(m)) {
    errors.push(`${path}: must be an object`);
    return errors;
  }
  if (!isNonEmptyString(m.source)) {
    errors.push(`${path}.source: must be a non-empty string`);
  }
  if (!isIsoUtc(m.asOf)) {
    errors.push(`${path}.asOf: must be ISO-8601 UTC date matching YYYY-MM-DDTHH:MM[:SS[.fff]]Z`);
  }
  if (m.status !== 'OK' && m.status !== 'UNAVAILABLE') {
    errors.push(`${path}.status: must be "OK" or "UNAVAILABLE"`);
    return errors;
  }
  if (m.status === 'OK') {
    if (!isNonNegInt(m.value)) {
      errors.push(`${path}.value: must be a non-negative integer when status is OK`);
    }
    if (m.reason !== null) {
      errors.push(`${path}.reason: must be null when status is OK`);
    }
  } else {
    if (m.value !== null) {
      errors.push(`${path}.value: must be null when status is UNAVAILABLE`);
    }
    if (!isNonEmptyString(m.reason)) {
      errors.push(`${path}.reason: must be a non-empty string when status is UNAVAILABLE`);
    }
  }
  return errors;
}

function validateSectionMeta(obj, path, errors) {
  if (!isNonEmptyString(obj.source)) {
    errors.push(`${path}.source: must be a non-empty string`);
  }
  if (!isIsoUtc(obj.asOf)) {
    errors.push(`${path}.asOf: must be ISO-8601 UTC date`);
  }
  if (obj.status !== 'OK' && obj.status !== 'UNAVAILABLE') {
    errors.push(`${path}.status: must be "OK" or "UNAVAILABLE"`);
  } else if (obj.status === 'UNAVAILABLE') {
    if (!isNonEmptyString(obj.reason)) {
      errors.push(`${path}.reason: must be a non-empty string when status is UNAVAILABLE`);
    }
  } else if (obj.reason !== null) {
    errors.push(`${path}.reason: must be null when status is OK`);
  }
}

function validateTotals(name, obj, path, errors) {
  const keys = TOTAL_KEYS[name];
  if (!isPlainObject(obj.totals)) {
    errors.push(`${path}.totals: must be an object`);
    return;
  }
  for (const key of keys) {
    errors.push(...validateMetric(obj.totals[key], `${path}.totals.${key}`));
  }
  if (obj.status === 'UNAVAILABLE') {
    for (const key of keys) {
      const metric = obj.totals[key];
      if (isPlainObject(metric) && metric.status === 'OK') {
        errors.push(`${path}.totals.${key}: must be UNAVAILABLE when section is UNAVAILABLE`);
      }
    }
  }
}

function validateListEmptyWhenUnavailable(obj, path, listKey, errors) {
  if (obj.status === 'UNAVAILABLE' && Array.isArray(obj[listKey]) && obj[listKey].length > 0) {
    errors.push(`${path}.${listKey}: must be empty when section is UNAVAILABLE`);
  }
}

function validateGithub(obj, path, errors) {
  validateTotals('github', obj, path, errors);
  if (!Array.isArray(obj.repos)) {
    errors.push(`${path}.repos: must be an array`);
  } else {
    obj.repos.forEach((repo, i) => {
      const p = `${path}.repos[${i}]`;
      if (!isPlainObject(repo)) {
        errors.push(`${p}: must be an object`);
        return;
      }
      if (!isNonEmptyString(repo.name)) errors.push(`${p}.name: must be a non-empty string`);
      if (!isNonEmptyString(repo.url)) errors.push(`${p}.url: must be a non-empty string`);
      if (repo.lastPushAt !== null && !isIsoUtc(repo.lastPushAt)) {
        errors.push(`${p}.lastPushAt: must be ISO-8601 UTC date or null`);
      }
      for (const key of ['commits7d', 'openPRs', 'openIssues']) {
        if (repo[key] !== null && !isNonNegInt(repo[key])) {
          errors.push(`${p}.${key}: must be a non-negative integer or null`);
        }
      }
      if (!CI_VALUES.has(repo.ci)) {
        errors.push(`${p}.ci: must be one of ${[...CI_VALUES].join('|')}`);
      }
    });
    validateListEmptyWhenUnavailable(obj, path, 'repos', errors);
  }
}

function validateVercel(obj, path, errors) {
  validateTotals('vercel', obj, path, errors);
  if (!Array.isArray(obj.projects)) {
    errors.push(`${path}.projects: must be an array`);
  } else {
    obj.projects.forEach((proj, i) => {
      const p = `${path}.projects[${i}]`;
      if (!isPlainObject(proj)) {
        errors.push(`${p}: must be an object`);
        return;
      }
      if (!isNonEmptyString(proj.name)) errors.push(`${p}.name: must be a non-empty string`);
      if (!VERCEL_STATES.has(proj.state)) {
        errors.push(`${p}.state: must be one of ${[...VERCEL_STATES].join('|')}`);
      }
      if (proj.url !== null && !isNonEmptyString(proj.url)) {
        errors.push(`${p}.url: must be a non-empty string or null`);
      }
      if (proj.deployedAt !== null && !isIsoUtc(proj.deployedAt)) {
        errors.push(`${p}.deployedAt: must be ISO-8601 UTC date or null`);
      }
      if (proj.error !== null && typeof proj.error !== 'string') {
        errors.push(`${p}.error: must be a string or null`);
      }
    });
    validateListEmptyWhenUnavailable(obj, path, 'projects', errors);
  }
}

function validateGmail(obj, path, errors) {
  validateTotals('gmail', obj, path, errors);
  if (!Array.isArray(obj.topThreads)) {
    errors.push(`${path}.topThreads: must be an array`);
  } else {
    if (obj.topThreads.length > 5) {
      errors.push(`${path}.topThreads: must hold at most 5 items`);
    }
    obj.topThreads.forEach((t, i) => {
      const p = `${path}.topThreads[${i}]`;
      if (!isPlainObject(t)) {
        errors.push(`${p}: must be an object`);
        return;
      }
      if (!isNonEmptyString(t.from)) errors.push(`${p}.from: must be a non-empty string`);
      if (!isNonEmptyString(t.subject)) errors.push(`${p}.subject: must be a non-empty string`);
      if (!isIsoUtc(t.receivedAt)) errors.push(`${p}.receivedAt: must be ISO-8601 UTC date`);
      if (typeof t.important !== 'boolean') errors.push(`${p}.important: must be a boolean`);
    });
    validateListEmptyWhenUnavailable(obj, path, 'topThreads', errors);
  }
}

function validateSupabase(obj, path, errors) {
  validateTotals('supabase', obj, path, errors);
  if (!Array.isArray(obj.projects)) {
    errors.push(`${path}.projects: must be an array`);
  } else {
    obj.projects.forEach((proj, i) => {
      const p = `${path}.projects[${i}]`;
      if (!isPlainObject(proj)) {
        errors.push(`${p}: must be an object`);
        return;
      }
      if (!isNonEmptyString(proj.name)) errors.push(`${p}.name: must be a non-empty string`);
      if (!isNonEmptyString(proj.ref)) errors.push(`${p}.ref: must be a non-empty string`);
      if (!isNonEmptyString(proj.status)) errors.push(`${p}.status: must be a non-empty string`);
      for (const key of ['securityAdvisors', 'performanceAdvisors']) {
        if (proj[key] !== null && !isNonNegInt(proj[key])) {
          errors.push(`${p}.${key}: must be a non-negative integer or null`);
        }
      }
    });
    validateListEmptyWhenUnavailable(obj, path, 'projects', errors);
  }
}

function validateAdvisor(obj, path, errors) {
  if (!Array.isArray(obj.recommendations)) {
    errors.push(`${path}.recommendations: must be an array`);
  } else {
    const recs = obj.recommendations;
    if (obj.status === 'OK' && recs.length !== 3) {
      errors.push(`${path}.recommendations: must have exactly 3 entries when status is OK`);
    }
    if (obj.status === 'UNAVAILABLE' && recs.length !== 0) {
      errors.push(`${path}.recommendations: must be empty when status is UNAVAILABLE`);
    }
    recs.forEach((rec, i) => {
      const p = `${path}.recommendations[${i}]`;
      if (!isPlainObject(rec)) {
        errors.push(`${p}: must be an object`);
        return;
      }
      if (rec.rank !== i + 1) {
        errors.push(`${p}.rank: ranks must be exactly [1,2,3] in order`);
      }
      if (!(rec.category in CATEGORY_PRIORITY)) {
        errors.push(`${p}.category: must be one of ${Object.keys(CATEGORY_PRIORITY).join('|')}`);
      }
      if (!isNonEmptyString(rec.action)) errors.push(`${p}.action: must be a non-empty string`);
      if (!isNonEmptyString(rec.evidence)) errors.push(`${p}.evidence: must be a non-empty string`);
      if (!isNonEmptyString(rec.risk)) errors.push(`${p}.risk: must be a non-empty string`);
      if (rec.category === 'unavailable') {
        if (rec.action !== 'UNAVAILABLE' || rec.evidence !== 'UNAVAILABLE' || rec.risk !== 'UNAVAILABLE') {
          errors.push(`${p}: an unavailable recommendation must have action, evidence and risk all equal to "UNAVAILABLE"`);
        }
      }
      if (rec.category === 'routine' && rec.action !== ROUTINE_ACTION) {
        errors.push(`${p}.action: a routine recommendation's action must be exactly "${ROUTINE_ACTION}"`);
      }
    });
    // category priority never decreases with rank
    for (let i = 1; i < recs.length; i += 1) {
      const prev = CATEGORY_PRIORITY[recs[i - 1] && recs[i - 1].category];
      const cur = CATEGORY_PRIORITY[recs[i] && recs[i].category];
      if (prev !== undefined && cur !== undefined && cur < prev) {
        errors.push(`${path}.recommendations[${i}].category: category priority must never decrease as rank increases`);
      }
    }
    const routineCount = recs.filter((r) => r && r.category === 'routine').length;
    const hasEvidence = recs.some((r) => r && ['blocker', 'outperforming', 'degrading'].includes(r.category));
    if (routineCount > 1) {
      errors.push(`${path}.recommendations: at most one routine recommendation is allowed`);
    }
    if (routineCount > 0 && hasEvidence) {
      errors.push(`${path}.recommendations: routine must not appear alongside blocker, outperforming or degrading`);
    }
  }

  if (!Array.isArray(obj.followUps)) {
    errors.push(`${path}.followUps: must be an array`);
  } else {
    if (obj.followUps.length > 10) {
      errors.push(`${path}.followUps: must hold at most 10 items`);
    }
    if (obj.status === 'UNAVAILABLE' && obj.followUps.length !== 0) {
      errors.push(`${path}.followUps: must be empty when section is UNAVAILABLE`);
    }
    obj.followUps.forEach((f, i) => {
      const p = `${path}.followUps[${i}]`;
      if (!isPlainObject(f)) {
        errors.push(`${p}: must be an object`);
        return;
      }
      if (!isDateStr(f.date)) errors.push(`${p}.date: must be a valid YYYY-MM-DD date`);
      if (!isNonEmptyString(f.action)) errors.push(`${p}.action: must be a non-empty string`);
      if (!(Number.isInteger(f.ageDays) && f.ageDays >= 1 && f.ageDays <= 7)) {
        errors.push(`${p}.ageDays: must be an integer between 1 and 7`);
      }
    });
  }
}

function validateResearch(obj, path, errors) {
  if (obj.topic !== null && !isNonEmptyString(obj.topic)) {
    errors.push(`${path}.topic: must be a non-empty string or null`);
  }
  if (obj.slug !== null) {
    if (typeof obj.slug !== 'string' || !SLUG_RE.test(obj.slug) || obj.slug.length > 60) {
      errors.push(`${path}.slug: must match ^[a-z0-9]+(-[a-z0-9]+)*$ and be at most 60 characters`);
    }
  }
  if (obj.generatedAt !== null && !isIsoUtc(obj.generatedAt)) {
    errors.push(`${path}.generatedAt: must be ISO-8601 UTC date or null`);
  }
  if (obj.status === 'OK') {
    if (!isNonEmptyString(obj.topic)) errors.push(`${path}.topic: must be a non-empty string when status is OK`);
    if (obj.slug === null) errors.push(`${path}.slug: must be set when status is OK`);
    if (obj.generatedAt === null) errors.push(`${path}.generatedAt: must be set when status is OK`);
    if (!isNonEmptyString(obj.summary) || obj.summary.length > 300) {
      errors.push(`${path}.summary: must be a non-empty string of at most 300 characters when status is OK`);
    }
    errors.push(...validateMetric(obj.sourceCount, `${path}.sourceCount`));
    if (isPlainObject(obj.sourceCount)) {
      if (obj.sourceCount.status !== 'OK') {
        errors.push(`${path}.sourceCount.status: must be OK when research status is OK`);
      } else if (!(obj.sourceCount.value >= 3)) {
        errors.push(`${path}.sourceCount.value: must be at least 3 when status is OK`);
      }
    }
  } else {
    if (obj.summary !== null) {
      errors.push(`${path}.summary: must be null when status is UNAVAILABLE`);
    }
    errors.push(...validateMetric(obj.sourceCount, `${path}.sourceCount`));
  }
}

function validateOrchestrator(obj, path, errors) {
  if (obj.status === 'UNAVAILABLE') {
    if (obj.lastRun !== null) {
      errors.push(`${path}.lastRun: must be null when section is UNAVAILABLE`);
    }
  } else if (obj.lastRun !== null) {
    if (!isPlainObject(obj.lastRun)) {
      errors.push(`${path}.lastRun: must be an object or null`);
    } else {
      if (!isNonEmptyString(obj.lastRun.task)) errors.push(`${path}.lastRun.task: must be a non-empty string`);
      if (!isIsoUtc(obj.lastRun.startedAt)) errors.push(`${path}.lastRun.startedAt: must be ISO-8601 UTC date`);
      if (!['COMPLETED', 'DENIED', 'FAILED'].includes(obj.lastRun.outcome)) {
        errors.push(`${path}.lastRun.outcome: must be one of COMPLETED|DENIED|FAILED`);
      }
    }
  }
  validateTotals('orchestrator', obj, path, errors);
}

/**
 * @param {'github'|'vercel'|'gmail'|'supabase'|'advisor'|'research'|'orchestrator'} name
 * @param {unknown} obj
 * @param {string} [path]
 * @returns {string[]}
 */
export function validateSection(name, obj, path = name) {
  const errors = [];
  if (!isPlainObject(obj)) {
    errors.push(`${path}: must be an object`);
    return errors;
  }
  validateSectionMeta(obj, path, errors);
  if (name === 'github') validateGithub(obj, path, errors);
  else if (name === 'vercel') validateVercel(obj, path, errors);
  else if (name === 'gmail') validateGmail(obj, path, errors);
  else if (name === 'supabase') validateSupabase(obj, path, errors);
  else if (name === 'advisor') validateAdvisor(obj, path, errors);
  else if (name === 'research') validateResearch(obj, path, errors);
  else if (name === 'orchestrator') validateOrchestrator(obj, path, errors);
  else errors.push(`${path}: unknown section name "${name}"`);
  return errors;
}

/**
 * @param {unknown} arr
 * @param {string} [path]
 * @returns {string[]}
 */
export function validateAlerts(arr, path = 'alerts') {
  const errors = [];
  if (!Array.isArray(arr)) {
    errors.push(`${path}: must be an array`);
    return errors;
  }
  if (arr.length > 20) {
    errors.push(`${path}: must hold at most 20 items`);
  }
  arr.forEach((a, i) => {
    const p = `${path}[${i}]`;
    if (!isPlainObject(a)) {
      errors.push(`${p}: must be an object`);
      return;
    }
    if (typeof a.metric !== 'string' || !METRIC_REF_RE.test(a.metric)) {
      errors.push(`${p}.metric: must match ^(github|vercel|gmail|supabase)\\.totals\\.[A-Za-z0-9]+$`);
    }
    if (!isNonEmptyString(a.message)) errors.push(`${p}.message: must be a non-empty string`);
    if (a.severity !== 'critical' && a.severity !== 'warning') {
      errors.push(`${p}.severity: must be "critical" or "warning"`);
    }
    if (!isNonEmptyString(a.source)) errors.push(`${p}.source: must be a non-empty string`);
    if (!isIsoUtc(a.asOf)) errors.push(`${p}.asOf: must be ISO-8601 UTC date`);
  });
  return errors;
}

function validateObjective(obj, errors) {
  const path = 'objective';
  if (!isPlainObject(obj)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  if (!isNonEmptyString(obj.title)) errors.push(`${path}.title: must be a non-empty string`);
  if (!Array.isArray(obj.targets)) {
    errors.push(`${path}.targets: must be an array`);
    return;
  }
  if (obj.targets.length > 6) {
    errors.push(`${path}.targets: must hold at most 6 items`);
  }
  obj.targets.forEach((t, i) => {
    const p = `${path}.targets[${i}]`;
    if (!isPlainObject(t)) {
      errors.push(`${p}: must be an object`);
      return;
    }
    if (!isNonEmptyString(t.id)) errors.push(`${p}.id: must be a non-empty string`);
    if (!isNonEmptyString(t.label)) errors.push(`${p}.label: must be a non-empty string`);
    if (typeof t.metricRef !== 'string' || !METRIC_REF_RE.test(t.metricRef)) {
      errors.push(`${p}.metricRef: must match ^(github|vercel|gmail|supabase)\\.totals\\.[A-Za-z0-9]+$`);
    }
    if (t.comparator !== 'atMost' && t.comparator !== 'atLeast') {
      errors.push(`${p}.comparator: must be "atMost" or "atLeast"`);
    }
    if (typeof t.target !== 'number') errors.push(`${p}.target: must be a number`);
    errors.push(...validateMetric(t.current, `${p}.current`));
    if (t.progress !== null && !(typeof t.progress === 'number' && t.progress >= 0 && t.progress <= 1)) {
      errors.push(`${p}.progress: must be a number between 0 and 1, or null`);
    }
    if (isPlainObject(t.current)) {
      const shouldBeNull = t.current.status === 'UNAVAILABLE';
      if (shouldBeNull && t.progress !== null) {
        errors.push(`${p}.progress: must be null exactly when current.status is UNAVAILABLE`);
      }
      if (!shouldBeNull && t.progress === null) {
        errors.push(`${p}.progress: must be null exactly when current.status is UNAVAILABLE`);
      }
    }
  });
}

/**
 * @param {unknown} obj
 * @returns {{valid:boolean, errors:string[]}}
 */
export function validateMissionControl(obj) {
  const errors = [];
  if (!isPlainObject(obj)) {
    return { valid: false, errors: ['(root): must be an object'] };
  }
  if (obj.schemaVersion !== 1) {
    errors.push('schemaVersion: must be exactly 1');
  }
  if (!isIsoUtc(obj.generatedAt)) {
    errors.push('generatedAt: must be ISO-8601 UTC date');
  }
  if (obj.dataMode !== 'mock' && obj.dataMode !== 'live') {
    errors.push('dataMode: must be "mock" or "live"');
  }
  errors.push(...validateAlerts(obj.alerts, 'alerts'));
  validateObjective(obj.objective, errors);

  for (const name of ['github', 'vercel', 'gmail', 'supabase', 'advisor', 'research', 'orchestrator']) {
    errors.push(...validateSection(name, obj[name], name));
  }

  return { valid: errors.length === 0, errors };
}
