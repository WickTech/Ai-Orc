// Orchestrator agent/executor registry (AC-35, AC-38).

/**
 * @typedef {{kind:'agent'|'script'|'executor', risk:'read'|'write'|'shell'|'claude', promptFile?:string, script?:string, description:string}} RegistryEntry
 */

/** @type {Record<string, RegistryEntry>} */
export const REGISTRY = {
  scout: { kind: 'agent', risk: 'read', promptFile: 'prompts/scout.md', description: 'Run the Scout read-only status agent' },
  advisor: { kind: 'agent', risk: 'read', promptFile: 'prompts/advisor.md', description: 'Run the Advisor recommendation agent' },
  search: { kind: 'agent', risk: 'read', promptFile: 'prompts/search.md', description: 'Run the Search quick-lookup agent' },
  researcher: { kind: 'agent', risk: 'read', promptFile: 'prompts/researcher.md', description: 'Run the Researcher deep-dive agent' },
  operator: { kind: 'agent', risk: 'write', promptFile: 'prompts/operator.md', description: 'Run the Operator drafting agent' },
  developer: { kind: 'agent', risk: 'write', promptFile: 'prompts/subagents/developer.md', description: 'Run the Developer sub-agent on a delegation brief' },
  content: { kind: 'agent', risk: 'write', promptFile: 'prompts/subagents/content.md', description: 'Run the Content sub-agent on a delegation brief' },
  'build-data': { kind: 'script', risk: 'read', script: 'scripts/build-data.mjs', description: 'Rebuild data/mission-control.json' },
  validate: { kind: 'script', risk: 'read', script: 'scripts/validate.mjs', description: 'Validate data/mission-control.json' },
  claude: { kind: 'executor', risk: 'claude', description: 'Run a free-form claude -p session' },
  shell: { kind: 'executor', risk: 'shell', description: 'Run a shell command' },
};

// Final review, MINOR "optional hardening": freeze the registry and every
// entry in it. `isKnownAgent`/`getAgent` (Object.hasOwn) already make a
// prototype-pollution-style lookup impossible, so this adds no new
// correctness guarantee — it's defense in depth against a future edit
// accidentally mutating REGISTRY (e.g. `REGISTRY[userInput] = {...}`) or
// reassigning an entry's `risk`/`kind` at runtime.
for (const entry of Object.values(REGISTRY)) Object.freeze(entry);
Object.freeze(REGISTRY);

/**
 * The ONLY safe way to look up a plan-controlled or CLI-controlled agent
 * name against REGISTRY (fix round 2, review CRITICAL #1). `REGISTRY` is a
 * plain object, so bare `REGISTRY[name]` truthiness accepts inherited
 * `Object.prototype` keys — `toString`, `constructor`, `hasOwnProperty`,
 * `valueOf`, `__proto__` and so on — as if they were real registry
 * entries. Every lookup of an untrusted name (CLI `--agent`, planner JSON
 * `steps[].agent`, router `--agent` passthrough) MUST go through
 * `isKnownAgent`/`getAgent` instead of `REGISTRY[name]` or `!REGISTRY[name]`.
 * @param {string} name
 * @returns {boolean}
 */
export function isKnownAgent(name) {
  return typeof name === 'string' && Object.hasOwn(REGISTRY, name);
}

/**
 * @param {string} name
 * @returns {RegistryEntry|undefined}
 */
export function getAgent(name) {
  return isKnownAgent(name) ? REGISTRY[name] : undefined;
}

/**
 * Fail closed (review CRITICAL #1 fix, item 3): anything that is not
 * exactly the literal risk `'read'` requires approval, including an
 * `undefined`/unknown risk from a name that should never have reached this
 * function in the first place. There is no risk value for which approval
 * is skipped by default.
 * @param {{risk:string}} step
 * @returns {boolean}
 */
export function requiresApproval(step) {
  return step.risk !== 'read';
}

const CONTROL_CHAR_NAMES = { 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r', 27: '\\e' };

// Unicode bidi-override and other invisible format characters (final review,
// MINOR "escaping misses Unicode bidi/format characters"; follow-up review,
// MINOR "write with numeric code points, not literal invisible characters,
// and cover the marks the first pass missed"): these render zero-width or
// reorder surrounding text, so escapeControlChars covering only C0/C1
// bytes still let a planner-authored string visually disguise itself in a
// terminal. Built from numeric code points below via String.fromCodePoint,
// so the set is reviewable by eye and this file never has to embed one of
// these characters literally -- not even inside a comment. That matters
// because two of them (U plus 2028 and U plus 2029) are themselves treated
// as line terminators by the JS spec, even inside a line comment, so
// pasting one in literally would silently truncate whatever comment it
// landed in.
// Code points covered, in order:
//   U+00AD              soft hyphen
//   U+061C              Arabic letter mark
//   U+180E              Mongolian vowel separator
//   U+200B..U+200F      zero-width space/joiner/non-joiner, LRM/RLM
//   U+2028..U+2029      line/paragraph separator
//   U+202A..U+202E      LRE/RLE/PDF/LRO/RLO
//   U+2060..U+206F      word joiner, invisible plus/times/separator, the
//                       isolates, deprecated inhibit/activate shaping
//                       controls
//   U+FEFF              BOM / zero-width no-break space
const BIDI_CODE_POINTS = [
  0x00ad,
  0x061c,
  0x180e,
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  0xfeff,
];
const BIDI_FORMAT_CHARS = new RegExp(
  `[${BIDI_CODE_POINTS.map((p) => (Array.isArray(p)
    ? `${String.fromCodePoint(p[0])}-${String.fromCodePoint(p[1])}`
    : String.fromCodePoint(p))).join('')}]`,
  'g',
);

/**
 * Escapes C0 controls, DEL, the C1 range, and Unicode bidi/format
 * characters (fix round 2 + final review, "escape approval-prompt text"):
 * a planner-authored or otherwise untrusted string must never be able to
 * use `\r` + a cursor-clear sequence, a bidi override, or a zero-width
 * character to make the terminal *display* something other than the
 * command that will actually run.
 * @param {string} text
 * @returns {string}
 */
export function escapeControlChars(text) {
  return String(text == null ? '' : text)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, (ch) => {
      const code = ch.codePointAt(0);
      return CONTROL_CHAR_NAMES[code] || `\\x${code.toString(16).padStart(2, '0')}`;
    })
    .replace(BIDI_FORMAT_CHARS, (ch) => `\\u${ch.codePointAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * For shell steps the description shown to the human must be the full
 * command verbatim (AC-36) — "verbatim" means every byte is visible, which
 * requires escaping control characters, not skipping it. It is never
 * truncated.
 * @param {{agent:string, input:string, description:string}} step
 * @returns {string}
 */
export function describeStep(step) {
  return step.agent === 'shell' ? escapeControlChars(step.input) : step.description;
}

const MAX_APPROVAL_INPUT_CHARS = 400;

/**
 * @param {string} text
 * @returns {string}
 */
export function truncateForApproval(text) {
  const s = String(text == null ? '' : text);
  if (s.length <= MAX_APPROVAL_INPUT_CHARS) return s;
  return `${s.slice(0, MAX_APPROVAL_INPUT_CHARS)}… [truncated, ${s.length} chars total]`;
}

/**
 * The text shown in the terminal approval prompt (fix round 1, review
 * IMPORTANT #10). Shell already shows its full command verbatim via
 * `describeStep` (AC-36's literal requirement, so it is not truncated
 * here). Every other approval-gated step (write agents and the free-form
 * `claude` step, including planner-authored input) additionally shows its
 * actual input, escaped and truncated, so the human approves what will
 * really run — not just a generic one-line description, and not a string
 * that control characters could make look like something else.
 * @param {{agent:string, input:string, description:string}} step
 * @returns {string}
 */
export function approvalDescription(step) {
  if (step.agent === 'shell') return describeStep(step);
  return `${step.description}: ${truncateForApproval(escapeControlChars(step.input))}`;
}
