import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler } from '../http.js';

const env = { API_TOKEN: 'read-secret', RECONCILE_TOKEN: 'write-secret' };
function setup() {
  const calls = [];
  const handler = createHandler({
    env,
    logger: { error() {} },
    client: {
      async lists(options) { calls.push(['lists', options]); return { data: [] }; },
      async balances() { throw Object.assign(new Error('Secret backend detail'), { status: 502 }); },
    },
    async reconcile(options) { calls.push(['reconcile', options]); return { dryRun: !options.apply }; },
  });
  return { handler, calls };
}

async function request(handler, path, token = 'read-secret', method = 'GET') {
  const response = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
  await handler({ url: path, method, headers: token ? { authorization: `Bearer ${token}` } : {} }, response);
  return { ...response, json: response.body ? JSON.parse(response.body) : null };
}

test('health is public but every other route requires its own token', async () => {
  const { handler } = setup();
  assert.equal((await request(handler, '/health', null)).status, 200);
  for (const [path, token] of [['/lists', null], ['/lists', 'write-secret'], ['/transactions', null], ['/reconcile', 'read-secret']]) {
    assert.equal((await request(handler, path, token, 'POST')).status, 401);
  }
});

test('refresh accepts only the exact value 1', async () => {
  const { handler, calls } = setup();
  assert.equal((await request(handler, '/lists?refresh=1')).status, 200);
  assert.equal((await request(handler, '/lists?refresh=false')).status, 200);
  assert.deepEqual(calls.map((call) => call[1].refresh), [true, false]);
});

test('apply requires explicit opt-in and the write token', async () => {
  const { handler, calls } = setup();
  assert.equal((await request(handler, '/reconcile?apply=true', 'write-secret', 'POST')).status, 403);
  assert.deepEqual(calls, []);
  env.ALLOW_ACTUAL_WRITES = 'true';
  assert.equal((await request(handler, '/reconcile?apply=true', 'write-secret', 'POST')).status, 200);
  assert.deepEqual(calls, [['reconcile', { apply: true }]]);
  delete env.ALLOW_ACTUAL_WRITES;
});

test('backend details are not exposed in HTTP responses', async () => {
  const { handler } = setup();
  const response = await request(handler, '/balances');
  assert.equal(response.status, 502);
  assert.deepEqual(response.json, { error: 'Request failed' });
});
