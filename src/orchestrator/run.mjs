// Sequential plan execution with dependency-aware skipping (AC-37).

import { getAgent, requiresApproval } from './registry.mjs';

/**
 * @typedef {{n:number, agent:string, risk:string, decision:'APPROVED'|'DENIED'|'AUTO'|'SKIPPED', exitCode:number|'TIMEOUT'|'SPAWN_ERROR'|null, durationMs:number|null, note:string|null, stdout:string, stderr:string}} StepResult
 */

function failureNote(exitCode) {
  if (exitCode === 'TIMEOUT') return 'step timed out';
  if (exitCode === 'SPAWN_ERROR') return 'spawn error';
  return `exit code ${exitCode}`;
}

/**
 * @param {{plan:object, executors:object, approve:Function, timeoutMs:number, now?:Function}} args
 * @returns {Promise<{results:StepResult[], exitCode:0|1|2, outcome:'COMPLETED'|'DENIED'|'FAILED'}>}
 */
export async function runPlan({ plan, executors, approve, timeoutMs }) {
  const results = [];
  /** @type {Record<number, 'denied'|'failed'>} */
  const blocked = {};

  for (const step of plan.steps) {
    // CRITICAL fix round 2: `getAgent` uses Object.hasOwn, so it returns
    // undefined for `toString`, `constructor`, `__proto__`,
    // `hasOwnProperty`, `valueOf` and any other name that is not a real,
    // own-property REGISTRY entry — unlike the old `REGISTRY[step.agent]`,
    // which resolved those to truthy inherited values. Fail closed: an
    // unknown agent name is refused outright, never dispatched anywhere
    // (in particular, never to the shell executor), and never asked for
    // approval, because there is nothing legitimate to approve.
    const entry = getAgent(step.agent);
    if (!entry) {
      blocked[step.n] = 'denied';
      results.push({
        n: step.n, agent: step.agent, risk: 'unknown', decision: 'DENIED',
        exitCode: null, durationMs: null, note: `unknown agent: ${step.agent}`,
        stdout: '', stderr: '',
      });
      continue;
    }
    // The registry is the single source of truth for risk (review IMPORTANT
    // #7): a planner-authored or otherwise tampered `step.risk` must never
    // decide whether approval is required.
    const risk = entry.risk;

    const blockingDep = (step.dependsOn || []).find((dep) => blocked[dep]);
    if (blockingDep) {
      const kind = blocked[blockingDep];
      blocked[step.n] = kind;
      results.push({
        n: step.n, agent: step.agent, risk, decision: 'SKIPPED',
        exitCode: null, durationMs: null, note: `dependency ${blockingDep} ${kind}`,
        stdout: '', stderr: '',
      });
      continue;
    }

    const needsApproval = requiresApproval({ risk });

    let decision = 'AUTO';
    if (needsApproval) {
      const { approved, reason } = await approve({ ...step, risk });
      if (!approved) {
        blocked[step.n] = 'denied';
        results.push({
          n: step.n, agent: step.agent, risk, decision: 'DENIED',
          exitCode: null, durationMs: null, note: reason || 'denied by user',
          stdout: '', stderr: '',
        });
        continue;
      }
      decision = 'APPROVED';
    }

    // Explicit, closed dispatch (review CRITICAL #1 fix): every branch names
    // the exact (kind, risk) pair it handles. There is no "else exec =
    // runShell" catch-all — an entry that somehow matches none of these
    // (impossible for a real REGISTRY entry today, but a future registry
    // bug must not silently default to the most dangerous executor) is
    // refused instead of run.
    let exec;
    if (entry.kind === 'agent') {
      exec = executors.runAgent;
    } else if (entry.kind === 'script') {
      exec = executors.runScript;
    } else if (entry.kind === 'executor' && risk === 'claude') {
      exec = executors.runClaude;
    } else if (entry.kind === 'executor' && risk === 'shell') {
      exec = executors.runShell;
    } else {
      blocked[step.n] = 'failed';
      results.push({
        n: step.n, agent: step.agent, risk, decision,
        exitCode: 'SPAWN_ERROR', durationMs: null, note: `no executor for registry entry (kind=${entry.kind}, risk=${risk})`,
        stdout: '', stderr: '',
      });
      continue;
    }

    const { exitCode, stdout, stderr, durationMs } = await exec(step, { timeoutMs });
    const failed = exitCode !== 0;
    if (failed) blocked[step.n] = 'failed';

    results.push({
      n: step.n, agent: step.agent, risk, decision,
      exitCode, durationMs, note: failed ? failureNote(exitCode) : null, stdout, stderr,
    });
  }

  const anyDenied = results.some((r) => r.decision === 'DENIED');
  const anyFailed = results.some((r) => (r.decision === 'AUTO' || r.decision === 'APPROVED') && r.exitCode !== 0);

  let exitCode;
  let outcome;
  if (anyDenied) {
    exitCode = 2;
    outcome = 'DENIED';
  } else if (anyFailed) {
    exitCode = 1;
    outcome = 'FAILED';
  } else {
    exitCode = 0;
    outcome = 'COMPLETED';
  }

  return { results, exitCode, outcome };
}
