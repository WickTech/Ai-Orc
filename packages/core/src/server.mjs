// Local read-only HTTP server (AC-20, AC-43, AC-45). This file must never
// spawn or run external commands, and must never pull in the CLI planning
// / approval / execution module tree — there is no execution surface here.

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const COMMON_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...COMMON_HEADERS,
  });
  res.end(body);
}

function hostAllowed(hostHeader) {
  if (!hostHeader) return false;
  const host = String(hostHeader).split(':')[0].toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

/**
 * @param {{rootDir:string}} args
 * @returns {import('node:http').Server}
 */
export function createAxionServer({ rootDir }) {
  const server = http.createServer(async (req, res) => {
    try {
      // Order of checks: Host, then method, then path (AC-45).
      if (!hostAllowed(req.headers.host)) {
        sendJson(res, 403, { error: 'bad host' });
        return;
      }

      const method = req.method || 'GET';
      const isGetOrHead = method === 'GET' || method === 'HEAD';
      if (!isGetOrHead) {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
      }

      // A malformed request-target (e.g. an unparsable IPv6-literal host in
      // the path) must never reach `new URL` unguarded: it throws, and an
      // unhandled rejection inside this async handler used to crash the
      // whole process (review IMPORTANT #4 — a local DoS). Parsing lives
      // inside this same try/catch, and a bad URL is just a 400.
      let pathname;
      try {
        pathname = new URL(req.url, 'http://x').pathname;
      } catch {
        sendJson(res, 400, { error: 'bad request' });
        return;
      }

      if (pathname === '/' || pathname === '/index.html') {
        const body = await fs.readFile(path.join(rootDir, 'dashboard', 'index.html'), 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          ...COMMON_HEADERS,
        });
        res.end(method === 'HEAD' ? undefined : body);
        return;
      }

      if (pathname === '/data/mission-control.json') {
        let body;
        try {
          body = await fs.readFile(path.join(rootDir, 'data', 'mission-control.json'), 'utf8');
        } catch {
          sendJson(res, 404, { error: 'not found' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          ...COMMON_HEADERS,
        });
        res.end(method === 'HEAD' ? undefined : body);
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch {
      sendJson(res, 404, { error: 'not found' });
    }
  });

  return server;
}
