import { timingSafeEqual } from 'node:crypto';

export function authorized(request, secret) {
  if (!secret) return false;
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization || '');
  if (!match || match[1].length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(match[1]), Buffer.from(secret));
}

export function sendJson(response, status, body) {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  response.end(data);
}

export function createHandler({ client, reconcile, env, logger = console }) {
  let reconciliation = null;
  async function runReconciliation(apply) {
    if (reconciliation) throw Object.assign(new Error('A reconciliation is already running'), { status: 409 });
    reconciliation = reconcile({ apply }).finally(() => { reconciliation = null; });
    return reconciliation;
  }

  return async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { status: 'ok', reconciling: Boolean(reconciliation) });
      return;
    }
    try {
      const writeRoute = url.pathname === '/reconcile';
      if (!authorized(request, env[writeRoute ? 'RECONCILE_TOKEN' : 'API_TOKEN'])) {
        sendJson(response, 401, { error: 'Valid bearer authentication is required' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/lists') {
        sendJson(response, 200, await client.lists({ refresh: url.searchParams.get('refresh') === '1' }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/balances') {
        sendJson(response, 200, await client.balances({
          listId: url.searchParams.get('list_id') || undefined,
          refresh: url.searchParams.get('refresh') === '1',
        }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/transactions') {
        sendJson(response, 200, await client.transactions({
          listId: url.searchParams.get('list_id') || undefined,
          refresh: url.searchParams.get('refresh') === '1',
        }));
        return;
      }
      if (request.method === 'POST' && writeRoute) {
        const apply = url.searchParams.get('apply') === 'true';
        if (apply && env.ALLOW_ACTUAL_WRITES !== 'true') {
          sendJson(response, 403, { error: 'Actual writes are disabled' });
          return;
        }
        sendJson(response, 200, await runReconciliation(apply));
        return;
      }
      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      logger.error(error);
      sendJson(response, Number.isInteger(error.status) ? error.status : 500, { error: 'Request failed' });
    }
  };
}
