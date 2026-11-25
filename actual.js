#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as api from '@actual-app/api';
import { SplitserClient } from './client.js';
import { loadEnv, splitserConfig } from './config.js';

const directory = dirname(fileURLToPath(import.meta.url));
const eur = (cents) => `€${(cents / 100).toFixed(2)}`;
const fail = (message) => { throw new Error(message); };

async function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
}

function localDate(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts();
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export async function splitserBalance(client, memberName) {
  if (!memberName) fail('Set SPLITSER_MEMBER_NAME to your exact Splitser name');
  const response = await client.balances();
  const lists = response.data.map((entry) => {
    const members = entry.data.filter((member) => member.member.full_name === memberName);
    if (members.length !== 1) {
      fail(`${entry.list.name}: expected one member named ${JSON.stringify(memberName)}, found ${members.length}`);
    }
    const member = members[0];
    if (member.balance_total.currency !== 'EUR') fail(`${entry.list.name}: expected EUR`);
    return {
      id: entry.list.id,
      name: entry.list.name,
      amount: member.balance_total.fractional,
      sourceUpdatedAt: new Date(Math.max(entry.list.modified_at || 0, entry.list.updated_at || 0) * 1000).toISOString(),
    };
  });
  return { memberName, amount: lists.reduce((sum, list) => sum + list.amount, 0), lists };
}

async function eventually(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail('Actual write did not become visible within 10 seconds');
}

export async function reconcile({ apply = false, json = false } = {}) {
  await loadEnv(directory);
  const source = await splitserBalance(
    new SplitserClient(splitserConfig(directory)), process.env.SPLITSER_MEMBER_NAME,
  );
  const accountName = process.env.ACTUAL_ACCOUNT || 'Splitser';
  const trackerName = process.env.ACTUAL_TRACKER_CATEGORY || 'Advances';
  const timeZone = process.env.ACTUAL_TIMEZONE || 'Europe/Amsterdam';
  const today = localDate(timeZone);
  const month = today.slice(0, 7);

  const dataDir = resolve(directory, process.env.ACTUAL_DATA_DIR || './.actual-data');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await quiet(() => api.init({
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_PASSWORD,
    dataDir,
  }));
  try {
    await quiet(() => api.downloadBudget(process.env.ACTUAL_SYNC_ID, {
      password: process.env.ACTUAL_ENCRYPTION_PASSWORD || undefined,
    }));
    const accounts = await api.getAccounts();
    const account = accounts.find((entry) => entry.name === accountName);
    if (!account?.offbudget) fail(`Actual needs an off-budget account named ${JSON.stringify(accountName)}`);
    const bankNames = (process.env.ACTUAL_BANK_ACCOUNTS || '').split(',').map((name) => name.trim()).filter(Boolean);
    const bankAccounts = bankNames.map((name) => accounts.find((entry) => entry.name === name && !entry.offbudget)
      || fail(`Actual on-budget bank account not found: ${JSON.stringify(name)}`));
    if (apply && bankAccounts.length === 0) fail('Set ACTUAL_BANK_ACCOUNTS before enabling writes');
    const bankBalances = async () => Object.fromEntries(await Promise.all(
      bankAccounts.map(async (entry) => [entry.name, await api.getAccountBalance(entry.id)]),
    ));
    const banksBefore = await bankBalances();
    let bankSync = null;
    if (apply) {
      bankSync = await api.runBankSync();
      if (bankSync.newTransactions.length > 0) {
        fail(`Bank sync imported ${bankSync.newTransactions.length} transaction(s); book them with book.mjs before reconciling`);
      }
      const afterSync = await bankBalances();
      if (JSON.stringify(banksBefore) !== JSON.stringify(afterSync)) {
        fail('Bank balances changed during sync; book the changes before reconciling');
      }
    }
    const budget = await api.getBudgetMonth(month);
    const tracker = budget.categoryGroups.flatMap((group) => group.categories)
      .find((entry) => entry.name === trackerName);
    if (!tracker) fail(`Actual needs a category named ${JSON.stringify(trackerName)}`);
    if (!tracker.carryover) fail(`${trackerName} must have carryover enabled`);

    const rows = await api.getTransactions(account.id, '0000-01-01', '9999-12-31');
    const adjustments = rows.filter((row) => row.imported_id?.startsWith('splitser:balance:'));
    if (adjustments.length > 1) fail('Multiple automatic Splitser adjustments found; inspect them before continuing');
    const existing = adjustments[0];
    const actualBefore = await api.getAccountBalance(account.id);
    const delta = source.amount - actualBefore;
    const trackerBefore = tracker.balance;
    const plan = {
      dryRun: !apply,
      date: today,
      source,
      account: { name: accountName, before: actualBefore, after: source.amount },
      tracker: { name: trackerName, before: trackerBefore, after: -source.amount, budgetedBefore: tracker.budgeted },
      adjustment: delta === 0 ? null : {
        importedId: 'splitser:balance:current',
        existingTransactionId: existing?.id || null,
        amount: delta,
      },
      trackerBudgetChange: delta === 0 ? null : {
        month,
        from: tracker.budgeted,
        to: tracker.budgeted - delta,
      },
      bankAccounts: Object.keys(banksBefore),
      bankSync,
    };

    if (json) console.log(JSON.stringify(plan, null, 2));
    else {
      console.log(`Splitser (${source.memberName}): ${eur(source.amount)} across ${source.lists.length} active lists`);
      for (const list of source.lists) console.log(`  ${list.name}: ${eur(list.amount)}`);
      console.log(`Actual ${accountName}: ${eur(actualBefore)}; proposed correction: ${eur(delta)}`);
      console.log(`${trackerName} ${month}: ${eur(trackerBefore)} -> ${eur(-source.amount)}`);
      console.log(apply ? 'Applying one idempotent balance adjustment and the matching tracker budget correction.' : 'DRY RUN: no Actual changes. Re-run with --apply to write.');
    }

    if (apply && delta !== 0) {
      if (actualBefore + trackerBefore !== 0) {
        fail(`${trackerName} does not equal minus ${accountName}; fix the existing drift before reconciling`);
      }
      const budgetMonths = await api.getBudgetMonths();
      if (!budgetMonths.includes(month)) fail(`Actual budget month ${month} does not exist`);
      const notes = `Splitser balance sync: ${source.lists.length} active lists, ${today}`;
      const id = existing?.id || randomUUID();
      if (existing) {
        await api.updateTransaction(id, { date: today, amount: delta, notes });
      } else {
        await api.addTransactions(account.id, [{
          id, date: today, amount: delta, notes, imported_id: 'splitser:balance:current', cleared: true,
        }]);
      }
      await api.setBudgetAmount(month, tracker.id, tracker.budgeted - delta);
      await quiet(() => api.sync());
      await eventually(async () => await api.getAccountBalance(account.id) === source.amount);
      await eventually(async () => {
        const current = await api.getBudgetMonth(month);
        const currentTracker = current.categoryGroups.flatMap((group) => group.categories)
          .find((entry) => entry.id === tracker.id);
        return currentTracker?.balance === -source.amount && currentTracker?.budgeted === tracker.budgeted - delta;
      });
      const banksAfter = await bankBalances();
      if (JSON.stringify(banksBefore) !== JSON.stringify(banksAfter)) {
        fail('Bank balances changed. Inspect Actual immediately; do not run reconciliation again.');
      }
      const result = { ...plan, dryRun: false, applied: true, verified: true, actualAfter: await api.getAccountBalance(account.id) };
      const output = resolve(directory, 'reconciliation.json');
      await writeFile(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
      if (!json) console.log(`Verified: ${accountName} = ${eur(source.amount)}, ${trackerName} = ${eur(-source.amount)}; bank balances unchanged.`);
      else console.log(JSON.stringify(result, null, 2));
    }
    return plan;
  } finally {
    await quiet(() => api.shutdown());
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  reconcile({ apply: args.includes('--apply'), json: args.includes('--json') })
    .catch((error) => { console.error(`FAILED: ${error.message}`); process.exitCode = 1; });
}
