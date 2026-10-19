// Planner support: parsing and validating a claude-produced plan (AC-34).

import { REGISTRY, isKnownAgent, getAgent, escapeControlChars } from './registry.mjs';

/**
 * @param {string} stdout
 * @returns {unknown}
 */
export function parsePlannerOutput(stdout) {
  const text = String(stdout || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    // fall through to fenced-block search
  }
  const match = /```json\s*([\s\S]*?)```/i.exec(text);
  if (match) {
    return JSON.parse(match[1].trim());
  }
  throw new Error('planner output did not contain JSON');
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * @param {unknown} raw
 * @returns {{ok:true, plan:object}|{ok:false, errors:string[]}}
 */
export function validatePlan(raw) {
  const errors = [];
  if (!isPlainObject(raw) || !Array.isArray(raw.steps)) {
    return { ok: false, errors: ['steps: must be an array of { agent, input, dependsOn }'] };
  }
  const rawSteps = raw.steps;
  if (rawSteps.length < 1 || rawSteps.length > 10) {
    errors.push('steps: must have between 1 and 10 entries');
  }

  rawSteps.forEach((s, i) => {
    const n = i + 1;
    const p = `steps[${i}]`;
    if (!isPlainObject(s)) {
      errors.push(`${p}: must be an object`);
      return;
    }
    // CRITICAL fix round 2: `!REGISTRY[s.agent]` accepted inherited
    // Object.prototype keys (toString, constructor, hasOwnProperty,
    // valueOf, __proto__, ...) as if they were real agents, because each
    // resolves to a truthy function/value via bracket lookup. `isKnownAgent`
    // uses `Object.hasOwn` so only real, own-property registry entries pass.
    if (typeof s.agent !== 'string' || !isKnownAgent(s.agent)) {
      // final review MINOR: this name is planner-authored and untrusted;
      // it reaches a real terminal (cli.mjs writes validatePlan's errors to
      // stderr verbatim), so it needs the same control-char/bidi escaping
      // as an approval prompt — otherwise it could visually spoof the
      // error text a human reads before deciding anything.
      errors.push(`${p}.agent: unknown agent "${escapeControlChars(String(s.agent))}"`);
    }
    if (typeof s.input !== 'string' || s.input.length > 2000) {
      errors.push(`${p}.input: must be a string of at most 2000 characters`);
    }
    const dependsOn = s.dependsOn === undefined ? [] : s.dependsOn;
    if (!Array.isArray(dependsOn)) {
      errors.push(`${p}.dependsOn: must be an array of step numbers`);
    } else {
      dependsOn.forEach((d, di) => {
        if (!Number.isInteger(d) || d < 1 || d > n - 1) {
          errors.push(`${p}.dependsOn[${di}]: must be an integer in [1, ${Math.max(n - 1, 0)}]`);
        }
      });
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const steps = rawSteps.map((s, i) => {
    const entry = getAgent(s.agent);
    return {
      n: i + 1,
      agent: s.agent,
      input: s.input,
      dependsOn: s.dependsOn || [],
      risk: entry.risk,
      description: entry.description,
    };
  });

  return { ok: true, plan: { steps } };
}

/**
 * @param {string} task
 * @returns {string}
 */
export function buildPlannerPrompt(task) {
  const names = Object.keys(REGISTRY).join(', ');
  return [
    'You are the AXION orchestrator planner. Break the task below into an ordered list of steps.',
    `Each step's "agent" must be one of: ${names}.`,
    'Reply with ONLY JSON in this exact shape (no prose, optionally inside a ```json fenced block):',
    '{ "steps": [ { "agent": "scout", "input": "string", "dependsOn": [] } ] }',
    '- 1 to 10 steps.',
    '- "input" is at most 2000 characters.',
    '- "dependsOn" entries are 1-based step numbers strictly less than the step\'s own number.',
    'Safety rules: nothing sends, spends, or publishes autonomously; every number has a source and a date;',
    'unverifiable numbers are reported UNAVAILABLE, never estimated; agents produce drafts, a human executes;',
    'no agent gains a new permission without the human granting it; the orchestrator never runs a write, shell,',
    'or claude step without explicit human approval in the terminal.',
    '',
    '## Task',
    task,
  ].join('\n');
}
