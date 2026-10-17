// Orchestrator CLI (AC-31 to AC-34, AC-39 to AC-41).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { REGISTRY, requiresApproval, describeStep, approvalDescription } from './registry.mjs';
import { routeTask, RouteError } from './router.mjs';
import { parsePlannerOutput, validatePlan, buildPlannerPrompt } from './plan.mjs';
import { askApproval } from './approval.mjs';
import { createExecutors } from './executors.mjs';
import { runPlan } from './run.mjs';
import { formatRunLog, appendRunLog, toOrchestratorSection } from './log.mjs';
import { buildMissionControl, writeBuildOutputs, writeAtomic } from '../build-data.mjs';

const HELP_TEXT = `Usage: npm run axion -- [options] "<task>"

Options:
  --agent <name>          run exactly one step for a registry entry
                           (scout, operator, developer, content, advisor,
                           search, researcher, build-data, validate, claude, shell)
  --plan-with-claude       ask Claude to plan the task, then validate the plan
  --dry-run                print the plan, run nothing, write nothing
  --timeout <minutes>      per-step timeout (default 10)
  --help                   show this help and exit 0

Exit codes: 0 all steps succeeded, 1 a step failed, 2 a step was denied,
3 usage, route or plan error (nothing ran).

There is no approval-bypass flag. Every write, shell or claude step is
gated by an explicit [y/N] prompt in the terminal; a non-TTY input is
always denied.
`;

// setTimeout's delay is a 32-bit signed int (max 2147483647 ms); above that
// Node fires almost immediately instead of waiting, silently turning every
// step into a TIMEOUT (review MINOR #16).
const MAX_TIMEOUT_MINUTES = Math.floor(2147483647 / 60000);

function parseArgv(argv) {
  let agentSeen = false;
  let agent;
  let dryRun = false;
  let planWithClaude = false;
  let timeoutRaw = '10';
  let help = false;
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help') {
      help = true;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--plan-with-claude') {
      planWithClaude = true;
    } else if (a === '--agent') {
      if (agentSeen) {
        return { error: '--agent may only be given once' };
      }
      agentSeen = true;
      i += 1;
      const value = argv[i];
      if (value === undefined || value === '' || value.startsWith('-')) {
        return { error: '--agent requires a non-empty agent name' };
      }
      agent = value;
    } else if (a === '--timeout') {
      i += 1;
      timeoutRaw = argv[i];
    } else if (a === '--yes' || a === '-y' || a === '--auto-approve') {
      return { error: `unknown option ${a} (no approval bypass exists)` };
    } else if (a.startsWith('-')) {
      return { error: `unknown option ${a}` };
    } else {
      positional.push(a);
    }
  }

  return {
    options: { agent, dryRun, planWithClaude, timeoutRaw, help },
    task: positional.length > 0 ? positional.join(' ') : undefined,
  };
}

async function readConfig(rootDir) {
  const text = await fs.readFile(path.join(rootDir, 'config', 'axion.config.json'), 'utf8');
  return JSON.parse(text);
}

async function writeSourceSection(rootDir, name, obj) {
  const p = path.join(rootDir, 'data', 'sources', `${name}.json`);
  await writeAtomic(p, `${JSON.stringify(obj, null, 2)}\n`);
}

/**
 * The planner call must use `executors.planner`'s allowlist (empty by
 * default, per A11), never `executors.claude`'s — exported so tests can
 * assert this without spawning anything real.
 * @param {object} config
 * @returns {object}
 */
export function buildPlannerConfig(config) {
  return {
    ...config,
    executors: {
      ...config.executors,
      claude: (config.executors && config.executors.planner) || { allowedTools: [] },
    },
  };
}

/**
 * @param {string[]} argv
 * @param {{rootDir:string, stdin:import('node:stream').Readable, stdout:import('node:stream').Writable,
 *          stderr:import('node:stream').Writable, isTTY:boolean, executors?:object, spawnImpl?:Function, now?:() => Date}} deps
 * @returns {Promise<number>}
 */
export async function main(argv, { rootDir, stdin, stdout, stderr, isTTY, executors: injectedExecutors, spawnImpl, now = () => new Date() }) {
  const parsed = parseArgv(argv);
  if (parsed.error) {
    stderr.write(`${parsed.error}\n`);
    return 3;
  }
  const { options, task } = parsed;

  if (options.help) {
    stdout.write(HELP_TEXT);
    return 0;
  }

  if (!task) {
    stderr.write('missing task; use --help for usage\n');
    return 3;
  }

  if (options.agent && options.planWithClaude) {
    stderr.write('--agent cannot be combined with --plan-with-claude\n');
    return 3;
  }

  const timeoutMinutes = Number(options.timeoutRaw);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
    stderr.write('--timeout must be a positive number of minutes\n');
    return 3;
  }
  if (timeoutMinutes > MAX_TIMEOUT_MINUTES) {
    stderr.write(`--timeout must be at most ${MAX_TIMEOUT_MINUTES} minutes (setTimeout's limit)\n`);
    return 3;
  }
  const timeoutMs = timeoutMinutes * 60000;

  let config;
  try {
    config = await readConfig(rootDir);
  } catch (err) {
    stderr.write(`could not read config/axion.config.json: ${err.message}\n`);
    return 3;
  }

  let plan;
  try {
    if (options.planWithClaude) {
      const approval = await askApproval({
        question: 'Ask Claude to plan this task?',
        input: stdin, output: stdout, isTTY,
      });
      if (!approval.approved) {
        stderr.write(`planner call denied: ${approval.reason}\n`);
        return 2;
      }

      const plannerExecutors = injectedExecutors || createExecutors({
        rootDir,
        config: buildPlannerConfig(config),
        spawnImpl,
      });
      const prompt = buildPlannerPrompt(task);
      const result = await plannerExecutors.runClaude({ agent: 'claude', input: prompt, risk: 'claude' }, { timeoutMs });

      let rawPlan;
      try {
        rawPlan = parsePlannerOutput(result.stdout);
      } catch (err) {
        stderr.write(`planner output error: ${err.message}\n`);
        return 3;
      }
      const validated = validatePlan(rawPlan);
      if (!validated.ok) {
        for (const e of validated.errors) stderr.write(`${e}\n`);
        return 3;
      }
      plan = validated.plan;
    } else if (options.agent) {
      plan = routeTask(task, { agent: options.agent });
    } else {
      plan = routeTask(task);
    }
  } catch (err) {
    if (err instanceof RouteError) {
      stderr.write(`${err.message}\n`);
      return 3;
    }
    stderr.write(`${err.message}\n`);
    return 3;
  }

  if (options.dryRun) {
    for (const step of plan.steps) {
      const approvalNeeded = requiresApproval(step) ? 'yes' : 'no';
      const deps = step.dependsOn && step.dependsOn.length ? step.dependsOn.join(',') : '-';
      stdout.write(`${step.n}. ${step.agent} [${step.risk}] approval:${approvalNeeded} dependsOn:${deps} — ${describeStep(step)}\n`);
    }
    return 0;
  }

  const executors = injectedExecutors || createExecutors({ rootDir, config, spawnImpl });
  const approve = (step) => askApproval({
    question: `Run step ${step.n}: ${approvalDescription(step)}?`,
    input: stdin, output: stdout, isTTY,
  });

  const startedAt = now().toISOString();
  const { results, exitCode, outcome } = await runPlan({ plan, executors, approve, timeoutMs, now });

  const logText = formatRunLog({ task, startedAt, results });
  await appendRunLog(rootDir, logText);

  const asOf = now().toISOString();
  const section = toOrchestratorSection({ task, startedAt, results, outcome, asOf });
  await writeSourceSection(rootDir, 'orchestrator', section);

  try {
    const buildNow = now();
    const { doc, errors } = await buildMissionControl({ rootDir, now: buildNow });
    if (errors.length === 0) {
      await writeBuildOutputs({ rootDir, doc, now: buildNow });
    } else {
      stderr.write(`warning: build-data validation failed after orchestrator run:\n${errors.join('\n')}\n`);
    }
  } catch (err) {
    stderr.write(`warning: build-data failed after orchestrator run: ${err.message}\n`);
  }

  return exitCode;
}

export { REGISTRY };
