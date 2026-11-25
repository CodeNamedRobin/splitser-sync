import { readdir, readFile } from 'node:fs/promises';

const owners = {
  'node:fs/promises': ['client.js', 'config.js', 'actual.js'],
  fetch: ['client.js'],
  'api.addTransactions': ['reconcile.js'],
  'api.updateTransaction': ['reconcile.js'],
  'api.setBudgetAmount': ['reconcile.js'],
  'api.runBankSync': ['reconcile.js'],
};
const files = (await readdir('.')).filter((name) => name.endsWith('.js'));
const failures = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const [boundary, allowed] of Object.entries(owners)) {
    if (source.includes(boundary) && !allowed.includes(file)) {
      failures.push(`${file}: ${boundary} belongs to ${allowed.join(', ')}`);
    }
  }
  if (
    /console\.(?:log|error)\([^)]*(?:password|secret|cookie|token)/i.test(
      source,
    )
  ) {
    failures.push(`${file}: possible credential logging`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
