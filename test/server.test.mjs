import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAxionServer } from '../src/server.mjs';

const SOCKET_TIMEOUT_MS = 5000;

async function makeRoot(t, { withData = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'axion-server-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'dashboard'), { recursive: true });
  await fs.mkdir(path.join(dir, 'data'), { recursive: true });
  await fs.writeFile(path.join(dir, 'dashboard', 'index.html'), '<html><body>AXION</body></html>');
  if (withData) {
    await fs.writeFile(path.join(dir, 'data', 'mission-control.json'), JSON.stringify({ schemaVersion: 1 }));
  }
  return dir;
}

function listenAndRegister(t, server) {
  t.after(() => closeServer(server));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    // Any lingering keep-alive socket would otherwise make close() wait
    // forever (review IMPORTANT #2): force every connection shut first.
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close(() => resolve());
  });
}

function request(port, { method = 'GET', path: p = '/', host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Host: host, Connection: 'close' };
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers, agent: false }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(SOCKET_TIMEOUT_MS, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end();
  });
}

/** Sends a raw HTTP/1.1 request with NO Host header at all (the http client
 * always injects one, so this needs a raw socket). */
function requestNoHostHeader(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write('GET / HTTP/1.1\r\nConnection: close\r\n\r\n');
    });
    socket.setTimeout(SOCKET_TIMEOUT_MS, () => socket.destroy(new Error('socket timed out')));
    let data = '';
    socket.on('data', (c) => { data += c.toString(); });
    socket.on('end', () => {
      const statusLine = data.split('\r\n')[0] || '';
      const match = /^HTTP\/1\.\d (\d+)/.exec(statusLine);
      resolve({ statusCode: match ? Number(match[1]) : null, raw: data });
    });
    socket.on('error', reject);
  });
}

/** Sends a raw, syntactically-malformed request-target that `new URL()`
 * cannot parse (an unterminated IPv6-literal-looking path). */
function requestMalformedTarget(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write('GET http://[/ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    });
    socket.setTimeout(SOCKET_TIMEOUT_MS, () => socket.destroy(new Error('socket timed out')));
    let data = '';
    socket.on('data', (c) => { data += c.toString(); });
    socket.on('end', () => {
      const statusLine = data.split('\r\n')[0] || '';
      const match = /^HTTP\/1\.\d (\d+)/.exec(statusLine);
      resolve({ statusCode: match ? Number(match[1]) : null, raw: data });
    });
    socket.on('error', () => resolve({ statusCode: null, raw: '' }));
  });
}

test('AC-20 + AC-45: serves the dashboard on / with a valid Host', async (t) => {
  const rootDir = await makeRoot(t);
  const server = createAxionServer({ rootDir });
  const port = await listenAndRegister(t, server);
  const res = await request(port, { path: '/', host: 'localhost:1234' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('AC-20: /data/mission-control.json 200 and 404 when missing', async (t) => {
  const rootDirWith = await makeRoot(t, { withData: true });
  const s1 = createAxionServer({ rootDir: rootDirWith });
  const p1 = await listenAndRegister(t, s1);
  const r1 = await request(p1, { path: '/data/mission-control.json' });
  assert.equal(r1.statusCode, 200);
  assert.match(r1.headers['content-type'], /application\/json/);

  const rootDirWithout = await makeRoot(t, { withData: false });
  const s2 = createAxionServer({ rootDir: rootDirWithout });
  const p2 = await listenAndRegister(t, s2);
  const r2 = await request(p2, { path: '/data/mission-control.json' });
  assert.equal(r2.statusCode, 404);
  assert.deepEqual(JSON.parse(r2.body), { error: 'not found' });
});

test('AC-20: other paths 404, including traversal attempts', async (t) => {
  const rootDir = await makeRoot(t);
  const server = createAxionServer({ rootDir });
  const port = await listenAndRegister(t, server);
  for (const p of ['/data/scout-log.md', '/../package.json', '/%2e%2e/package.json', '/nope']) {
    const res = await request(port, { path: p });
    assert.equal(res.statusCode, 404, p);
  }
});

test('AC-20: non-GET/HEAD methods return 405', async (t) => {
  const rootDir = await makeRoot(t);
  const server = createAxionServer({ rootDir });
  const port = await listenAndRegister(t, server);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await request(port, { method, path: '/' });
    assert.equal(res.statusCode, 405);
    assert.deepEqual(JSON.parse(res.body), { error: 'method not allowed' });
  }
});

test('AC-43: write methods to execution-looking paths still return 405, never spawn', async (t) => {
  const rootDir = await makeRoot(t);
  const server = createAxionServer({ rootDir });
  const port = await listenAndRegister(t, server);
  for (const p of ['/', '/data/mission-control.json', '/run', '/api/run']) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await request(port, { method, path: p, host: 'localhost' });
      assert.equal(res.statusCode, 405, `${method} ${p}`);
    }
  }
});

test('AC-45: bad/missing Host is rejected with 403 before method/path checks', async (t) => {
  const rootDir = await makeRoot(t);
  const server = createAxionServer({ rootDir });
  const port = await listenAndRegister(t, server);

  const r1 = await request(port, { path: '/', host: 'evil.example' });
  assert.equal(r1.statusCode, 403);
  assert.deepEqual(JSON.parse(r1.body), { error: 'bad host' });

  const r2 = await request(port, { path: '/', host: 'evil.example:4173' });
  assert.equal(r2.statusCode, 403);

  const r3 = await request(port, { path: '/', host: 'localhost:4173' });
  assert.equal(r3.statusCode, 200);

  const r4 = await request(port, { path: '/', host: '127.0.0.1:4173' });
  assert.equal(r4.statusCode, 200);

  const r5 = await request(port, { path: '/', host: 'LOCALHOST' });
  assert.equal(r5.statusCode, 200);

  const r6 = await request(port, { method: 'POST', path: '/', host: 'evil.example' });
  assert.equal(r6.statusCode, 403);

  // Node's own HTTP/1.1 parser rejects a request with no Host header
  // before it ever reaches our handler (RFC 7230 requires one), so this
  // comes back as a 400 from Node itself rather than our 403 — either
  // way, a missing Host header is rejected, never served (A22).
  const r7 = await requestNoHostHeader(port);
  assert.notEqual(r7.statusCode, 200);
});

test('AC-45: [::1] is rejected (server binds 127.0.0.1 only)', async (t) => {
  const rootDir = await makeRoot(t);
  const server = createAxionServer({ rootDir });
  const port = await listenAndRegister(t, server);
  const res = await request(port, { path: '/', host: '[::1]:4173' });
  assert.equal(res.statusCode, 403);
});

test('IMPORTANT #4: a malformed request-target never crashes the server, returns 400', async (t) => {
  const rootDir = await makeRoot(t);
  const server = createAxionServer({ rootDir });
  server.on('clientError', () => { /* Node's own HTTP parser may reject some malformed targets before we ever see them; that is fine too. */ });
  const port = await listenAndRegister(t, server);

  // review round 2 MINOR #7: actually detect a crash instead of a dead
  // `serverCrashed` variable that was never set. The original bug (an
  // unhandled rejection from `new URL()` thrown inside an async request
  // handler) surfaces as `unhandledRejection`/`uncaughtException` on the
  // process, which is exactly what we listen for here.
  let serverCrashed = false;
  let crashError = null;
  const onCrash = (err) => { serverCrashed = true; crashError = err; };
  process.on('uncaughtException', onCrash);
  process.on('unhandledRejection', onCrash);
  t.after(() => {
    process.removeListener('uncaughtException', onCrash);
    process.removeListener('unhandledRejection', onCrash);
  });

  const res = await requestMalformedTarget(port);
  assert.notEqual(res.statusCode, 200);
  if (res.statusCode !== null) {
    assert.ok(res.statusCode === 400 || res.statusCode === 404, `expected 400 or 404, got ${res.statusCode}`);
  }

  // The server must still be alive and answering normal requests.
  const follow = await request(port, { path: '/', host: 'localhost' });
  assert.equal(follow.statusCode, 200);
  assert.equal(serverCrashed, false, crashError ? String((crashError && crashError.stack) || crashError) : undefined);
});

test('review MINOR #24: responses include X-Content-Type-Options: nosniff', async (t) => {
  const rootDir = await makeRoot(t);
  const server = createAxionServer({ rootDir });
  const port = await listenAndRegister(t, server);
  const res = await request(port, { path: '/', host: 'localhost' });
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  const bad = await request(port, { path: '/', host: 'evil.example' });
  assert.equal(bad.headers['x-content-type-options'], 'nosniff');
});

test('static source check: server.mjs does not contain the strings "child_process" or "orchestrator"', async () => {
  const text = await fs.readFile(path.join(process.cwd(), 'src', 'server.mjs'), 'utf8');
  assert.ok(!text.includes('child_process'));
  assert.ok(!text.includes('orchestrator'));
});

test('AC-43: child_process.spawn/execFile are never called across these requests', async (t) => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const cp = require('node:child_process');
  let spawnCalls = 0;
  let execFileCalls = 0;
  t.mock.method(cp, 'spawn', () => { spawnCalls += 1; });
  t.mock.method(cp, 'execFile', () => { execFileCalls += 1; });

  const rootDir = await makeRoot(t);
  const server = createAxionServer({ rootDir });
  const port = await listenAndRegister(t, server);
  await request(port, { path: '/', host: 'localhost' });
  await request(port, { method: 'POST', path: '/run', host: 'localhost' });
  await request(port, { path: '/data/mission-control.json', host: 'localhost' });

  assert.equal(spawnCalls, 0);
  assert.equal(execFileCalls, 0);
});
