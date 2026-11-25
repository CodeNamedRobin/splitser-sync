import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SplitserClient } from './client.js';
import { loadEnv, splitserConfig } from './config.js';
import { reconcile } from './actual.js';

const directory = dirname(fileURLToPath(import.meta.url));
await loadEnv(directory);
const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8787),
};
const client = new SplitserClient(splitserConfig(directory));
let reconciliation = null;

function authorized(request, variable) {
  const secret = process.env[variable];
  if (!secret) return false;
  const supplied = request.headers.authorization?.replace(/^Bearer /, '');
  return supplied && supplied.length === secret.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}

function sendJson(response, status, body) {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  response.end(data);
}

async function runReconciliation(apply) {
  if (reconciliation) throw Object.assign(new Error('A reconciliation is already running'), { status: 409 });
  reconciliation = reconcile({ apply }).finally(() => { reconciliation = null; });
  return reconciliation;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { status: 'ok', reconciling: Boolean(reconciliation) });
    return;
  }

  try {
    if (process.env.API_TOKEN && url.pathname !== '/reconcile' && !authorized(request, 'API_TOKEN')) {
      sendJson(response, 401, { error: 'A valid API_TOKEN bearer token is required' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/lists') {
      sendJson(response, 200, await client.lists({ refresh: url.searchParams.has('refresh') }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/balances') {
      sendJson(response, 200, await client.balances({
        listId: url.searchParams.get('list_id') || undefined,
        refresh: url.searchParams.has('refresh'),
      }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/transactions') {
      sendJson(response, 200, await client.transactions({
        listId: url.searchParams.get('list_id') || undefined,
        refresh: url.searchParams.has('refresh'),
      }));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/reconcile') {
      if (!authorized(request, 'RECONCILE_TOKEN')) {
        sendJson(response, 401, { error: 'A valid RECONCILE_TOKEN bearer token is required' });
        return;
      }
      const apply = url.searchParams.get('apply') === 'true';
      if (apply && process.env.ALLOW_ACTUAL_WRITES !== 'true') {
        sendJson(response, 403, { error: 'Set ALLOW_ACTUAL_WRITES=true to enable Actual writes' });
        return;
      }
      sendJson(response, 200, await runReconciliation(apply));
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    sendJson(response, error.status || 500, { error: error.message });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Splitser API listening on http://${config.host}:${config.port}`);
  const interval = Number(process.env.RECONCILE_INTERVAL_MINUTES || 0);
  if (interval > 0) {
    if (process.env.ALLOW_ACTUAL_WRITES !== 'true') {
      throw new Error('Scheduled reconciliation requires ALLOW_ACTUAL_WRITES=true');
    }
    const schedule = () => runReconciliation(true).catch((error) => {
      console.error(`Scheduled reconciliation failed: ${error.message}`);
    });
    schedule();
    setInterval(schedule, interval * 60000).unref();
  }
});
