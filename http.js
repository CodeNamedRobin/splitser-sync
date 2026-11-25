import { timingSafeEqual } from 'node:crypto';

export function authorized(
  /** @type {any} */ request,
  /** @type {any} */ secret,
) {
  if (!secret) return false;
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization || '');
  const supplied = match?.[1];
  if (!supplied || supplied.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}

export function sendJson(
  /** @type {any} */ response,
  /** @type {number} */ status,
  /** @type {any} */ body,
) {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  response.end(data);
}

/** @param {{client: any, reconcile: any, env: any, logger?: any}} options */
export function createHandler({ client, reconcile, env, logger = console }) {
  /** @type {Promise<any> | null} */
  let reconciliation = null;
  async function runReconciliation(/** @type {any} */ apply) {
    if (reconciliation)
      throw Object.assign(new Error('A reconciliation is already running'), {
        status: 409,
      });
    reconciliation = reconcile({ apply }).finally(() => {
      reconciliation = null;
    });
    return reconciliation;
  }

  return async (/** @type {any} */ request, /** @type {any} */ response) => {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(/** @type {any} */ response, 200, {
        status: 'ok',
        reconciling: Boolean(reconciliation),
      });
      return;
    }
    try {
      const writeRoute = url.pathname === '/reconcile';
      if (
        !authorized(
          /** @type {any} */ request,
          /** @type {any} */ env[writeRoute ? 'RECONCILE_TOKEN' : 'API_TOKEN'],
        )
      ) {
        sendJson(/** @type {any} */ response, 401, {
          error: 'Valid bearer authentication is required',
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/lists') {
        sendJson(
          /** @type {any} */ response,
          200,
          await client.lists({
            refresh: url.searchParams.get('refresh') === '1',
          }),
        );
        return;
      }
      if (request.method === 'GET' && url.pathname === '/balances') {
        sendJson(
          /** @type {any} */ response,
          200,
          await client.balances({
            listId: url.searchParams.get('list_id') || undefined,
            refresh: url.searchParams.get('refresh') === '1',
          }),
        );
        return;
      }
      if (request.method === 'GET' && url.pathname === '/transactions') {
        sendJson(
          /** @type {any} */ response,
          200,
          await client.transactions({
            listId: url.searchParams.get('list_id') || undefined,
            refresh: url.searchParams.get('refresh') === '1',
          }),
        );
        return;
      }
      if (request.method === 'POST' && writeRoute) {
        const apply = url.searchParams.get('apply') === 'true';
        if (apply && env.ALLOW_ACTUAL_WRITES !== 'true') {
          sendJson(/** @type {any} */ response, 403, {
            error: 'Actual writes are disabled',
          });
          return;
        }
        sendJson(
          /** @type {any} */ response,
          200,
          await runReconciliation(apply),
        );
        return;
      }
      sendJson(/** @type {any} */ response, 404, { error: 'Not found' });
    } catch (/** @type {any} */ error) {
      logger.error(error);
      sendJson(
        /** @type {any} */ response,
        Number.isInteger(error.status) ? error.status : 500,
        {
          error: 'Request failed',
        },
      );
    }
  };
}
