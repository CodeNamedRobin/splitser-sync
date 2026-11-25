import { readdir, readFile } from 'node:fs/promises';

const owners: Record<string, string[]> = {
  'node:fs/promises': ['client.ts', 'config.ts', 'actual.ts'],
  fetch: ['client.ts'],
  'api.addTransactions': ['reconcile.ts'],
  'api.updateTransaction': ['reconcile.ts'],
  'api.setBudgetAmount': ['reconcile.ts'],
  'api.runBankSync': ['reconcile.ts'],
};
const files = (await readdir('src')).filter((name) => name.endsWith('.ts'));
const failures: string[] = [];
for (const file of files) {
  const source = await readFile(`src/${file}`, 'utf8');
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
