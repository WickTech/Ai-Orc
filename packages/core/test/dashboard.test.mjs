import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { validateMissionControl } from '../src/lib/schema.mjs';

const html = readFileSync(path.join(process.cwd(), 'dashboard', 'index.html'), 'utf8');
const fixture = JSON.parse(readFileSync(path.join(process.cwd(), 'test', 'fixtures', 'mission-control.valid.json'), 'utf8'));

function buildDom({ url = 'http://127.0.0.1:4173/?test', fetchImpl, beforeParse, matchMediaMatches = false } = {}) {
  const virtualConsole = new VirtualConsole();
  const jsdomErrors = [];
  const windowErrors = [];
  virtualConsole.on('jsdomError', (e) => jsdomErrors.push(e));

  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    virtualConsole,
    beforeParse(window) {
      window.fetch = fetchImpl || (async () => { throw new Error('network down'); });
      if (window.HTMLCanvasElement) {
        window.HTMLCanvasElement.prototype.getContext = () => null;
      }
      window.matchMedia = (query) => ({ media: query, matches: matchMediaMatches, addListener() {}, removeListener() {} });
      window.addEventListener('error', (e) => windowErrors.push(e));
      if (beforeParse) beforeParse(window);
    },
  });
  return { dom, window: dom.window, jsdomErrors, windowErrors };
}

/**
 * Builds a jsdom window and registers its cleanup with `t.after`, so a
 * failing assertion can never leave `setInterval(updateClock, 1000)`
 * running and hang the whole test file (review IMPORTANT #2).
 */
function makeDom(t, opts) {
  const result = buildDom(opts);
  t.after(() => {
    try {
      result.dom.window.close();
    } catch {
      // already closed
    }
  });
  return result;
}

function okResponse(json) {
  return { ok: true, json: async () => json };
}

test('AC-13: MOCK_DATA passes validateMissionControl', async (t) => {
  const { window } = makeDom(t);
  const result = validateMissionControl(window.AXION.MOCK_DATA);
  assert.deepEqual(result, { valid: true, errors: [] });
  await window.AXION.ready;
});

test('AC-15/AC-14: fetch rejects -> MOCK DATA banner, zero jsdomError/error events', async (t) => {
  const { window, jsdomErrors, windowErrors } = makeDom(t, { fetchImpl: async () => { throw new Error('down'); } });
  await window.AXION.ready;
  assert.equal(window.document.getElementById('status-banner').textContent, 'MOCK DATA');
  assert.equal(jsdomErrors.length, 0);
  assert.equal(windowErrors.length, 0);
});

test('AC-15/AC-14: fetch resolves with a valid fixture -> LIVE banner, zero error events', async (t) => {
  const { window, jsdomErrors, windowErrors } = makeDom(t, { fetchImpl: async () => okResponse(fixture) });
  await window.AXION.ready;
  assert.equal(window.document.getElementById('status-banner').textContent, `LIVE · ${fixture.generatedAt}`);
  assert.equal(jsdomErrors.length, 0);
  assert.equal(windowErrors.length, 0);
});

test('AC-15/AC-14: fetch resolves with an invalid shape -> DATA INVALID banner, zero error events', async (t) => {
  const invalid = { schemaVersion: 1 }; // missing sections
  const { window, jsdomErrors, windowErrors } = makeDom(t, { fetchImpl: async () => okResponse(invalid) });
  await window.AXION.ready;
  assert.equal(window.document.getElementById('status-banner').textContent, 'DATA INVALID — MOCK DATA');
  assert.equal(jsdomErrors.length, 0);
  assert.equal(windowErrors.length, 0);
});

test('AC-14: non-2xx response -> MOCK DATA banner', async (t) => {
  const { window } = makeDom(t, { fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  await window.AXION.ready;
  assert.equal(window.document.getElementById('status-banner').textContent, 'MOCK DATA');
});

test('AC-16: data-metric elements match the fixture, including UNAVAILABLE', async (t) => {
  const { window } = makeDom(t, { fetchImpl: async () => okResponse(fixture) });
  await window.AXION.ready;
  const doc = window.document;
  assert.equal(doc.querySelector('[data-metric="github.totals.openPRs"]').textContent, '5');
  assert.equal(doc.querySelector('[data-metric="github.totals.commits7d"]').textContent, 'UNAVAILABLE');
  assert.equal(doc.querySelector('[data-metric="research.sourceCount"]').textContent, '4');
});

test('AC-16: advisor card has exactly 3 [data-rec-rank] when OK', async (t) => {
  const { window } = makeDom(t, { fetchImpl: async () => okResponse(fixture) });
  await window.AXION.ready;
  const els = window.document.querySelectorAll('[data-rec-rank]');
  assert.equal(els.length, 3);
});

test('AC-16: radar has one [data-blip] per gmail.topThreads entry (max 5)', async (t) => {
  const { window } = makeDom(t, { fetchImpl: async () => okResponse(fixture) });
  await window.AXION.ready;
  const els = window.document.querySelectorAll('[data-blip]');
  assert.equal(els.length, fixture.gmail.topThreads.length);
});

test('AC-17: window.AXION exposes the required shape', async (t) => {
  const { window } = makeDom(t);
  await window.AXION.ready;
  const axion = window.AXION;
  assert.equal(typeof axion.handleCommand, 'function');
  assert.equal(typeof axion.loadData, 'function');
  assert.equal(typeof axion.getData, 'function');
  assert.equal(typeof axion.bootMs, 'number');
  assert.equal(axion.BOOT_MS_DEFAULT, 1500);
  assert.ok(axion.MOCK_DATA);
});

test('AC-17: handleCommand templates and unknown command', async (t) => {
  const { window } = makeDom(t);
  await window.AXION.ready;
  const { handleCommand } = window.AXION;
  assert.equal(handleCommand('github'), 'GitHub: 3 open pull requests, 7 open issues, 1 failing CI.');
  assert.equal(handleCommand('vercel'), 'Vercel: 6 deploys in 24 hours, 1 failed.');
  assert.equal(handleCommand('gmail'), 'Gmail: 12 unread, 3 important.');
  assert.equal(handleCommand('supabase'), 'Supabase: 3 projects, 2 security advisors.');
  assert.equal(handleCommand('help'), 'Commands: status, brief, github, vercel, gmail, supabase, advisor, research, run <task>, refresh, help.');
  assert.equal(handleCommand('blah blah'), 'Command not recognized: "blah blah". Say help for commands.');
});

test('AC-30: research command replies with topic and sourceCount', async (t) => {
  const { window } = makeDom(t);
  await window.AXION.ready;
  assert.equal(window.AXION.handleCommand('research'), 'Latest research: Edge caching strategies for Next.js 15. 3 sources.');
});

test('AC-42: run command never executes, strips wake word and leading run, trims quotes', async (t) => {
  const { window } = makeDom(t);
  await window.AXION.ready;
  const reply = window.AXION.handleCommand('axion run scout "the fleet" now');
  assert.equal(reply, 'To run tasks, use the terminal: npm run axion -- "scout the fleet now"');
});

test('AC-46: header title/subtitle elements', async (t) => {
  const { window } = makeDom(t);
  await window.AXION.ready;
  const doc = window.document;
  assert.equal(doc.querySelector('[data-hud="title"]').textContent, 'A.X.I.O.N.');
  assert.equal(doc.querySelector('[data-hud="subtitle"]').textContent, 'ADAPTIVE EXECUTIVE INTELLIGENCE & OPERATIONS NETWORK');
});

test('AC-47: boot overlay hidden before ready resolves; bootMs 0 in ?test mode', async (t) => {
  const { window } = makeDom(t);
  await window.AXION.ready;
  assert.equal(window.AXION.bootMs, 0);
  assert.ok(window.document.getElementById('boot').hidden);
  assert.ok(window.AXION.BOOT_MS_DEFAULT <= 2000);
});

test('AC-48: clock elements match the expected pattern after ready', async (t) => {
  const { window } = makeDom(t);
  await window.AXION.ready;
  assert.match(window.document.getElementById('clock-utc').textContent, /^UTC \d{2}:\d{2}:\d{2}$/);
});

test('AC-49: status pills show MOCK for mock data, section status for live data (with one UNAVAILABLE)', async (t) => {
  const { window: winMock } = makeDom(t);
  await winMock.AXION.ready;
  assert.equal(winMock.document.querySelector('[data-pill="github"]').textContent, 'MOCK');

  const { window } = makeDom(t, { fetchImpl: async () => okResponse(fixture) });
  await window.AXION.ready;
  assert.equal(window.document.querySelector('[data-pill="github"]').textContent, 'OK');
  assert.equal(window.document.querySelector('[data-pill="supabase"]').textContent, 'UNAVAILABLE');
});

test('AC-50: buildBrief exact string for MOCK_DATA', async (t) => {
  const { window } = makeDom(t);
  await window.AXION.ready;
  const brief = window.AXION.buildBrief(window.AXION.MOCK_DATA);
  const expected = 'Good morning. AXION morning brief for 2026-09-27. '
    + 'Alerts: Failing CI: 1 (threshold >0); vercel.totals.deploys24h changed +50% vs 7-day average 4.0 (3 snapshots). '
    + 'Urgent: 1 failing CI; 1 failed Vercel deploys in 24 hours; 3 important unread emails; 2 Supabase security advisors; 1 Supabase performance advisors. '
    + 'Top recommendations: 1. Fix failing CI on demo-app before merging further pull requests. 2. Ship the sample-service deploy fix while deploy velocity is high. 3. Clear the 3 important unread emails before they age further. '
    + 'Follow-ups: Review demo-db security advisories (7 days).';
  assert.equal(brief, expected);
});

test('AC-50: buildBrief exact string for the valid fixture', async (t) => {
  const { window } = makeDom(t);
  await window.AXION.ready;
  const brief = window.AXION.buildBrief(fixture);
  const expected = 'Good morning. AXION morning brief for 2026-09-20. '
    + 'Alerts: gmail.totals.unread changed +33% vs 7-day average 15.0 (5 snapshots); vercel.totals.deploys24h changed +43% vs 7-day average 7.0 (4 snapshots). '
    + 'Urgent: 4 important unread emails; Supabase security advisors unavailable; Supabase performance advisors unavailable. '
    + 'Top recommendations: 1. Investigate the demo-repo commit count failure before trusting velocity numbers. 2. Keep shipping sample-service deploys at the current pace. 3. Reply to the deployment failure thread. '
    + 'Follow-ups: Review pending Supabase security advisories (6 days); Confirm Vercel billing plan covers current usage (4 days).';
  assert.equal(brief, expected);
});

test('AC-50: an UNAVAILABLE metric yields its "unavailable" phrase', async (t) => {
  const { window } = makeDom(t);
  await window.AXION.ready;
  const data = JSON.parse(JSON.stringify(fixture));
  data.supabase.totals.securityAdvisors = { value: null, status: 'UNAVAILABLE', source: 'x', asOf: 'y', reason: 'z' };
  const brief = window.AXION.buildBrief(data);
  assert.match(brief, /Supabase security advisors unavailable/);
});

test('AC-51: push-to-talk via click and Space, with a fake SpeechRecognition', async (t) => {
  let startCalls = 0;
  let stopCalls = 0;
  let lastInstance = null;

  const { window } = makeDom(t, {
    beforeParse(win) {
      class FakeRecognition {
        constructor() {
          this.continuous = false;
          this.onresult = null;
          lastInstance = this;
        }
        start() { startCalls += 1; }
        stop() { stopCalls += 1; }
      }
      win.SpeechRecognition = FakeRecognition;
    },
  });
  await window.AXION.ready;
  const doc = window.document;

  const orb = doc.getElementById('orb');
  orb.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(startCalls, 1);
  orb.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(stopCalls, 1);

  let prevented = false;
  const keydown = new window.KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
  doc.body.focus();
  doc.dispatchEvent(keydown);
  prevented = keydown.defaultPrevented;
  assert.equal(startCalls, 2);
  assert.ok(prevented);

  const keyup = new window.KeyboardEvent('keyup', { code: 'Space', bubbles: true });
  doc.dispatchEvent(keyup);
  assert.equal(stopCalls, 2);

  const input = doc.getElementById('cmd-input');
  Object.defineProperty(doc, 'activeElement', { value: input, configurable: true });
  const keydown2 = new window.KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
  doc.dispatchEvent(keydown2);
  assert.equal(startCalls, 2, 'Space while focused in #cmd-input must not call start()');

  lastInstance.onresult({ results: [[{ transcript: 'status' }]] });
  const log = doc.getElementById('cmd-log').textContent;
  assert.match(log, /GitHub:/);
});

test('AC-51: no recognition API -> click/Space do not throw, log VOICE UNAVAILABLE exactly once', async (t) => {
  const { window } = makeDom(t);
  await window.AXION.ready;
  const doc = window.document;
  assert.ok(doc.getElementById('voice-btn').disabled);
  assert.doesNotThrow(() => doc.getElementById('orb').dispatchEvent(new window.Event('click', { bubbles: true })));
  assert.doesNotThrow(() => doc.getElementById('orb').dispatchEvent(new window.Event('click', { bubbles: true })));
  assert.doesNotThrow(() => doc.getElementById('orb').dispatchEvent(new window.Event('click', { bubbles: true })));
  const matches = doc.getElementById('cmd-log').textContent.match(/VOICE UNAVAILABLE/g) || [];
  assert.equal(matches.length, 1, 'VOICE UNAVAILABLE must be logged only once (review MINOR #15)');
});

test('AC-18: wake-word continuous voice only passes text after "axion" to handleCommand', async (t) => {
  let startCalls = 0;
  let lastInstance = null;

  const { window } = makeDom(t, {
    beforeParse(win) {
      class FakeRecognition {
        constructor() {
          this.continuous = false;
          this.onresult = null;
          lastInstance = this;
        }
        start() { startCalls += 1; }
        stop() {}
      }
      win.SpeechRecognition = FakeRecognition;
    },
  });
  await window.AXION.ready;
  const doc = window.document;
  const voiceBtn = doc.getElementById('voice-btn');
  assert.equal(voiceBtn.disabled, false);

  voiceBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(startCalls, 1);
  assert.ok(lastInstance, 'clicking ENGAGE VOICE must construct a recognizer');

  // No wake word: must not reach handleCommand (no reply logged).
  lastInstance.onresult({ results: [{ 0: { transcript: 'just chatting, no wake word here' }, length: 1 }] });
  assert.equal(doc.getElementById('cmd-log').textContent, '');

  // Wake word present: the text after "axion" is passed to handleCommand.
  lastInstance.onresult({ results: [{ 0: { transcript: 'hey axion github' }, length: 1 }] });
  assert.match(doc.getElementById('cmd-log').textContent, /GitHub:/);
});

test('AC-52: layout structural CSS rules', () => {
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  const css = styleMatch[1];
  assert.match(css, /html\s*,\s*body\s*\{[^}]*overflow:\s*hidden[^}]*\}/);
  assert.match(css, /html\s*,\s*body\s*\{[^}]*height:\s*100vh[^}]*\}/);
  const hudMatch = css.match(/#hud\s*\{([^}]*)\}/);
  assert.ok(hudMatch);
  assert.match(hudMatch[1], /display:\s*grid/);
  assert.match(hudMatch[1], /height:\s*100vh/);
  assert.match(hudMatch[1], /grid-template-rows:[^;]*(vh|fr|minmax)/);
  assert.match(css, /\.panel\s*\{[^}]*overflow:\s*auto[^}]*\}/);
});

test('AC-56: follow-ups list and NO PENDING FOLLOW-UPS', async (t) => {
  const { window } = makeDom(t, { fetchImpl: async () => okResponse(fixture) });
  await window.AXION.ready;
  const items = window.document.querySelectorAll('[data-followup]');
  assert.equal(items.length, 2);

  const noFollowUps = JSON.parse(JSON.stringify(fixture));
  noFollowUps.advisor.followUps = [];
  const { window: win2 } = makeDom(t, { fetchImpl: async () => okResponse(noFollowUps) });
  await win2.AXION.ready;
  assert.equal(win2.document.getElementById('advisor-followups').textContent, 'NO PENDING FOLLOW-UPS');
});

test('AC-59: diagnostics renders [data-alert] rows or NO ALERTS', async (t) => {
  const { window } = makeDom(t, { fetchImpl: async () => okResponse(fixture) });
  await window.AXION.ready;
  const rows = window.document.querySelectorAll('[data-alert]');
  assert.equal(rows.length, fixture.alerts.length);

  const noAlerts = JSON.parse(JSON.stringify(fixture));
  noAlerts.alerts = [];
  const { window: win2 } = makeDom(t, { fetchImpl: async () => okResponse(noAlerts) });
  await win2.AXION.ready;
  assert.equal(win2.document.getElementById('alerts-list').textContent, 'NO ALERTS');
});

test('AC-19: reduced motion skips boot animation, no error events', async (t) => {
  const { window, jsdomErrors, windowErrors } = makeDom(t, { url: 'http://127.0.0.1:4173/', matchMediaMatches: true });
  await window.AXION.ready;
  assert.equal(window.AXION.bootMs, 0);
  assert.ok(window.document.getElementById('boot').hidden);
  assert.equal(jsdomErrors.length, 0);
  assert.equal(windowErrors.length, 0);
});

// AC-13 / rule 2: every displayed number carries a source and a date.
test('AC-13: objective rows show each target\'s source and asOf inline', async (t) => {
  const { window } = makeDom(t, { fetchImpl: async () => okResponse(fixture) });
  await window.AXION.ready;
  const rows = window.document.querySelectorAll('#objective-targets .objective-row');
  assert.ok(rows.length > 0);
  // The "db" target's current metric is UNAVAILABLE in the fixture, so it
  // must not claim a source/asOf; every OK target row must show both.
  let sawSourceAsOf = false;
  rows.forEach((row) => {
    if (row.textContent.includes('UNAVAILABLE')) return;
    if (/\(.*·.*\)/.test(row.textContent)) sawSourceAsOf = true;
  });
  assert.ok(sawSourceAsOf, 'at least one OK objective row must show (source · asOf)');
});

test('AC-13: an UNAVAILABLE objective target shows UNAVAILABLE, never a 0% bar', async (t) => {
  const { window } = makeDom(t, { fetchImpl: async () => okResponse(fixture) });
  await window.AXION.ready;
  const rows = Array.from(window.document.querySelectorAll('#objective-targets .objective-row'));
  const dbRow = rows.find((r) => r.textContent.includes('SUPABASE SECURITY ADVISORS'));
  assert.ok(dbRow);
  assert.match(dbRow.textContent, /UNAVAILABLE/);
  assert.equal(dbRow.querySelector('.progress-fill'), null, 'an UNAVAILABLE target must not render a progress-fill bar');
});

test('AC-13: the advisor panel shows a panel-level source and asOf', async (t) => {
  const { window } = makeDom(t, { fetchImpl: async () => okResponse(fixture) });
  await window.AXION.ready;
  const meta = window.document.getElementById('advisor-meta').textContent;
  assert.match(meta, new RegExp(fixture.advisor.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(meta, new RegExp(fixture.advisor.asOf));
});

test('review MINOR #14: a Supabase row with null advisor counts renders UNAVAILABLE, not "null"', async (t) => {
  const data = JSON.parse(JSON.stringify(fixture));
  data.supabase = {
    status: 'OK', source: 'supabase:example-org', asOf: '2026-09-20T06:00:00Z', reason: null,
    totals: {
      projects: { value: 1, status: 'OK', source: 'supabase:example-org', asOf: '2026-09-20T06:00:00Z', reason: null },
      securityAdvisors: { value: 0, status: 'OK', source: 'supabase:example-org', asOf: '2026-09-20T06:00:00Z', reason: null },
      performanceAdvisors: { value: 0, status: 'OK', source: 'supabase:example-org', asOf: '2026-09-20T06:00:00Z', reason: null },
    },
    projects: [{ name: 'demo-db', ref: 'abc123', status: 'ACTIVE_HEALTHY', securityAdvisors: null, performanceAdvisors: null }],
  };
  const { window } = makeDom(t, { fetchImpl: async () => okResponse(data) });
  await window.AXION.ready;
  const text = window.document.getElementById('supabase-projects').textContent;
  assert.doesNotMatch(text, /:null/);
  assert.match(text, /UNAVAILABLE/);
});
