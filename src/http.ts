import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SplitserClient } from './client.ts';
import type { ReconcilePlan } from './reconcile.ts';

export function authorized(
  request: Pick<IncomingMessage, 'headers'>,
  secret: string | undefined,
): boolean {
  if (!secret) return false;
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization || '');
  const supplied = match?.[1];
  if (!supplied || supplied.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}

export function sendJson(
  response: Pick<ServerResponse, 'writeHead' | 'end'>,
  status: number,
  body: unknown,
): void {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  response.end(data);
}

export interface HandlerOptions {
  client: Pick<SplitserClient, 'lists' | 'balances' | 'transactions'>;
  reconcile: (options: { apply: boolean }) => Promise<ReconcilePlan>;
  env: Record<string, string | undefined>;
  logger?: { error: (...args: unknown[]) => void };
}

export function createHandler({
  client,
  reconcile,
  env,
  logger = console,
}: HandlerOptions) {
  let reconciliation: Promise<ReconcilePlan> | null = null;
  async function runReconciliation(apply: boolean) {
    if (reconciliation)
      throw Object.assign(new Error('A reconciliation is already running'), {
        status: 409,
      });
    reconciliation = reconcile({ apply }).finally(() => {
      reconciliation = null;
    });
    return reconciliation;
  }

  return async (
    request: Pick<IncomingMessage, 'url' | 'method' | 'headers'>,
    response: Pick<ServerResponse, 'writeHead' | 'end'>,
  ): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, {
        status: 'ok',
        reconciling: Boolean(reconciliation),
      });
      return;
    }
    try {
      const writeRoute = url.pathname === '/reconcile';
      if (
        !authorized(request, env[writeRoute ? 'RECONCILE_TOKEN' : 'API_TOKEN'])
      ) {
        sendJson(response, 401, {
          error: 'Valid bearer authentication is required',
        });
        return;
      }
      const refresh = url.searchParams.get('refresh') === '1';
      const listId = url.searchParams.get('list_id') || undefined;
      if (request.method === 'GET' && url.pathname === '/lists') {
        sendJson(response, 200, await client.lists({ refresh }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/balances') {
        sendJson(
          response,
          200,
          await client.balances(
            listId === undefined ? { refresh } : { listId, refresh },
          ),
        );
        return;
      }
      if (request.method === 'GET' && url.pathname === '/transactions') {
        sendJson(
          response,
          200,
          await client.transactions(
            listId === undefined ? { refresh } : { listId, refresh },
          ),
        );
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
      const status = (error as { status?: unknown }).status;
      sendJson(response, Number.isInteger(status) ? (status as number) : 500, {
        error: 'Request failed',
      });
    }
  };
}
