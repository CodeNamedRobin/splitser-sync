import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler } from '../src/http.ts';

const env: Record<string, string | undefined> = {
  API_TOKEN: 'read-secret',
  RECONCILE_TOKEN: 'write-secret',
};
function setup() {
  const calls: unknown[][] = [];
  const handler = createHandler({
    env,
    logger: { error() {} },
    client: {
      async lists(options?: { refresh?: boolean }) {
        calls.push(['lists', options]);
        return { data: [] };
      },
      async transactions(): Promise<never> {
        throw new Error('unused');
      },
      async balances(): Promise<never> {
        throw Object.assign(new Error('Secret backend detail'), {
          status: 502,
        });
      },
    },
    async reconcile(options: { apply: boolean }) {
      calls.push(['reconcile', options]);
      return { dryRun: !options.apply } as never;
    },
  });
  return { handler, calls };
}

async function request(
  handler: ReturnType<typeof createHandler>,
  path: string,
  token: string | null = 'read-secret',
  method = 'GET',
) {
  const response = {
    status: 0,
    headers: {} as unknown,
    body: '',
    writeHead(status: number, headers: unknown) {
      this.status = status;
      this.headers = headers;
    },
    end(body: string) {
      this.body = body;
    },
  };
  await handler(
    {
      url: path,
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    },
    response as never,
  );
  return {
    ...response,
    json: response.body ? JSON.parse(response.body) : null,
  };
}

test('health is public but every other route requires its own token', async () => {
  const { handler } = setup();
  assert.equal((await request(handler, '/health', null)).status, 200);
  for (const [path, token] of [
    ['/lists', null],
    ['/lists', 'write-secret'],
    ['/transactions', null],
    ['/reconcile', 'read-secret'],
  ] as [string, string | null][]) {
    assert.equal((await request(handler, path, token, 'POST')).status, 401);
  }
});

test('refresh accepts only the exact value 1', async () => {
  const { handler, calls } = setup();
  assert.equal((await request(handler, '/lists?refresh=1')).status, 200);
  assert.equal((await request(handler, '/lists?refresh=false')).status, 200);
  assert.deepEqual(
    calls.map((call) => (call[1] as { refresh: boolean }).refresh),
    [true, false],
  );
});

test('apply requires explicit opt-in and the write token', async () => {
  const { handler, calls } = setup();
  assert.equal(
    (await request(handler, '/reconcile?apply=true', 'write-secret', 'POST'))
      .status,
    403,
  );
  assert.deepEqual(calls, []);
  env.ALLOW_ACTUAL_WRITES = 'true';
  assert.equal(
    (await request(handler, '/reconcile?apply=true', 'write-secret', 'POST'))
      .status,
    200,
  );
  assert.deepEqual(calls, [['reconcile', { apply: true }]]);
  delete env.ALLOW_ACTUAL_WRITES;
});

test('backend details are not exposed in HTTP responses', async () => {
  const { handler } = setup();
  const response = await request(handler, '/balances');
  assert.equal(response.status, 502);
  assert.deepEqual(response.json, { error: 'Request failed' });
});
