// Terminal approval gate (AC-36). Default is always No; there is no bypass.

import readline from 'node:readline';

/**
 * @param {{question:string, input:import('node:stream').Readable, output:import('node:stream').Writable, isTTY:boolean}} args
 * @returns {Promise<{approved:boolean, reason:string|null}>}
 */
export async function askApproval({ question, input, output, isTTY }) {
  if (!isTTY) {
    return { approved: false, reason: 'approval required (no TTY)' };
  }

  return new Promise((resolve) => {
    let settled = false;
    const rl = readline.createInterface({ input, output, terminal: false });

    rl.on('close', () => {
      if (settled) return;
      settled = true;
      resolve({ approved: false, reason: 'denied by user' });
    });

    rl.question(`${question} [y/N] `, (answer) => {
      if (settled) return;
      settled = true;
      rl.close();
      const normalized = String(answer || '').trim().toLowerCase();
      if (normalized === 'y' || normalized === 'yes') {
        resolve({ approved: true, reason: null });
      } else {
        resolve({ approved: false, reason: 'denied by user' });
      }
    });
  });
}
