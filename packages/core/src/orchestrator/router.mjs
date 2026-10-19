// Deterministic task router (AC-32, AC-33).

import { REGISTRY, getAgent, escapeControlChars } from './registry.mjs';

export class RouteError extends Error {}

const CANONICAL_ORDER = ['scout', 'operator', 'developer', 'content', 'search', 'researcher', 'advisor', 'build-data', 'validate'];

const KEYWORDS = {
  scout: ['scout', 'status', 'intel', 'health', 'briefing'],
  operator: ['draft', 'drafts', 'reply', 'replies', 'inbox', 'email', 'operator'],
  developer: ['patch', 'bugfix', 'pull request', 'pr description', 'issue description', 'developer'],
  content: ['post', 'blog', 'tweet', 'linkedin', 'newsletter', 'content'],
  search: ['search', 'lookup', 'look up', 'what is', 'who is'],
  researcher: ['research', 'deep dive', 'investigate'],
  advisor: ['advise', 'advisor', 'recommend', 'recommendations', 'priorities', 'briefing'],
  'build-data': ['rebuild', 'build data'],
  validate: ['validate'],
};

const OPERATOR_OTHER_RE = /\b(reply|replies|inbox|email|operator)\b/i;

function groupRegex(words) {
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
}

const GROUP_REGEXES = Object.fromEntries(
  Object.entries(KEYWORDS).map(([name, words]) => [name, groupRegex(words)]),
);

/**
 * @typedef {{n:number, agent:string, input:string, dependsOn:number[], risk:string, description:string}} PlanStep
 * @typedef {{steps: PlanStep[]}} Plan
 */

/**
 * @param {string} task
 * @param {{agent?:string}} [opts]
 * @returns {Plan}
 */
export function routeTask(task, opts = {}) {
  if (opts && opts.agent) {
    const name = opts.agent;
    // CRITICAL fix round 2: `REGISTRY[name]` truthiness accepted inherited
    // Object.prototype keys (toString, constructor, __proto__, ...) as a
    // "real" agent. `getAgent` uses Object.hasOwn and returns undefined for
    // anything that isn't a genuine, own-property registry entry.
    const entry = getAgent(name);
    if (!entry) {
      // final review MINOR: `name` is CLI/planner-controlled and this
      // message reaches a real terminal via cli.mjs's stderr.write, so it
      // gets the same escaping as an approval prompt (see plan.mjs).
      throw new RouteError(`unknown agent: ${escapeControlChars(String(name))}`);
    }
    const step = { n: 1, agent: name, input: task, dependsOn: [], risk: entry.risk, description: entry.description };
    return { steps: [step] };
  }

  const matched = new Set();
  for (const name of CANONICAL_ORDER) {
    if (GROUP_REGEXES[name].test(task)) {
      matched.add(name);
    }
  }

  // Drop rules.
  if (matched.has('researcher')) {
    matched.delete('search');
  }
  if (matched.has('operator') && !OPERATOR_OTHER_RE.test(task) && (matched.has('developer') || matched.has('content'))) {
    matched.delete('operator');
  }

  const order = CANONICAL_ORDER.filter((name) => matched.has(name));
  if (order.length === 0) {
    throw new RouteError('no route for task; use --agent <name> or --plan-with-claude');
  }

  const stepNumberOf = (name) => {
    const idx = order.indexOf(name);
    return idx === -1 ? undefined : idx + 1;
  };

  const steps = order.map((name, idx) => {
    const entry = REGISTRY[name];
    const dependsOn = [];
    if (name === 'operator') {
      const n = stepNumberOf('scout');
      if (n) dependsOn.push(n);
    } else if (name === 'developer' || name === 'content') {
      const n = stepNumberOf('operator');
      if (n) dependsOn.push(n);
    } else if (name === 'advisor') {
      const s = stepNumberOf('scout');
      const o = stepNumberOf('operator');
      if (s) dependsOn.push(s);
      if (o) dependsOn.push(o);
    } else if (name === 'validate') {
      const n = stepNumberOf('build-data');
      if (n) dependsOn.push(n);
    }
    return { n: idx + 1, agent: name, input: task, dependsOn, risk: entry.risk, description: entry.description };
  });

  return { steps };
}
