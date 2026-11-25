const fail = (/** @type {any} */ message) => {
  throw new Error(message);
};

/** @param {{source: any, apply: boolean, api: any, config: any}} options */
export async function reconcileWithActual({ source, apply, api, config }) {
  const accounts = await api.getAccounts();
  const account = accounts.find(
    (/** @type {any} */ entry) => entry.name === config.accountName,
  );
  if (!account?.offbudget)
    fail(
      `Actual needs an off-budget account named ${JSON.stringify(config.accountName)}`,
    );
  const bankAccounts = config.bankNames.map(
    (/** @type {any} */ name) =>
      accounts.find(
        (/** @type {any} */ entry) => entry.name === name && !entry.offbudget,
      ) ||
      fail(`Actual on-budget bank account not found: ${JSON.stringify(name)}`),
  );
  if (apply && bankAccounts.length === 0)
    fail('Set ACTUAL_BANK_ACCOUNTS before enabling writes');

  const snapshotBanks = async () =>
    Object.fromEntries(
      (await api.getAccounts())
        .filter((/** @type {any} */ entry) =>
          bankAccounts.some((/** @type {any} */ bank) => bank.id === entry.id),
        )
        .map((/** @type {any} */ entry) => [
          entry./** @type {any} */ name,
          {
            transactions: entry.balance_current,
            available: entry.balance_available,
            lastSync: entry.last_sync,
            status: entry.bank_sync_status,
          },
        ]),
    );
  const banksBefore = await snapshotBanks();
  let bankSync = null;
  if (/** @type {any} */ apply) {
    bankSync = await api.runBankSync();
    if (!Array.isArray(bankSync?.newTransactions))
      fail('Actual bank sync returned an invalid result');
    if (bankSync.newTransactions.length > 0) {
      fail(
        `Bank sync imported ${bankSync.newTransactions.length} transaction(s); book them in Actual before reconciling`,
      );
    }
    if (JSON.stringify(banksBefore) !== JSON.stringify(await snapshotBanks())) {
      fail(
        'Bank balances changed during sync; book the changes before reconciling',
      );
    }
  }

  const budget = await api.getBudgetMonth(config.month);
  const tracker = budget.categoryGroups
    .flatMap((/** @type {any} */ group) => group.categories)
    .find((/** @type {any} */ entry) => entry.name === config.trackerName);
  if (!tracker)
    fail(`Actual needs a category named ${JSON.stringify(config.trackerName)}`);
  if (!tracker.carryover)
    fail(`${config.trackerName} must have carryover enabled`);

  const rows = await api.getTransactions(
    account.id,
    '0000-01-01',
    '9999-12-31',
  );
  const adjustments = rows.filter((/** @type {any} */ row) =>
    row.imported_id?.startsWith('splitser:balance:'),
  );
  if (adjustments.length > 1)
    fail(
      'Multiple automatic Splitser adjustments found; inspect them before continuing',
    );
  const existing = adjustments[0];
  const actualBefore = await api.getAccountBalance(account.id);
  const delta = source.amount - actualBefore;
  const trackerBefore = tracker.balance;
  if (apply && actualBefore + trackerBefore !== 0) {
    fail(
      `${config.trackerName} does not equal minus ${config.accountName}; fix the existing drift before reconciling`,
    );
  }
  if (apply && !(await api.getBudgetMonths()).includes(config.month)) {
    fail(`Actual budget month ${config.month} does not exist`);
  }

  const plan = {
    dryRun: !(/** @type {any} */ apply),
    /** @type {any} */ source,
    account: {
      name: config.accountName,
      before: actualBefore,
      after: source.amount,
    },
    tracker: {
      name: config.trackerName,
      before: trackerBefore,
      after: -source.amount,
      budgetedBefore: tracker.budgeted,
    },
    adjustment:
      delta === 0
        ? null
        : {
            importedId: 'splitser:balance:current',
            existingTransactionId: existing?.id || null,
            amount: delta,
          },
    trackerBudgetChange:
      delta === 0
        ? null
        : {
            month: config.month,
            from: tracker.budgeted,
            to: tracker.budgeted - delta,
          },
    bankAccounts: Object.keys(banksBefore),
    bankSync,
  };

  if (apply && delta !== 0) {
    const notes = `Splitser balance sync: ${source.lists.length} active lists, ${config.today}`;
    const id = existing?.id || config.id();
    if (existing)
      await api.updateTransaction(id, {
        date: config.today,
        amount: delta,
        notes,
      });
    else
      await api.addTransactions(account.id, [
        {
          id,
          date: config.today,
          amount: delta,
          notes,
          imported_id: 'splitser:balance:current',
          cleared: true,
        },
      ]);
    await api.setBudgetAmount(
      config.month,
      tracker.id,
      tracker.budgeted - delta,
    );
    await api.sync();
    await api.eventually(
      async () => (await api.getAccountBalance(account.id)) === source.amount,
    );
    await api.eventually(async () => {
      const current = await api.getBudgetMonth(config.month);
      const currentTracker = current.categoryGroups
        .flatMap((/** @type {any} */ group) => group.categories)
        .find((/** @type {any} */ entry) => entry.id === tracker.id);
      return (
        currentTracker?.balance === -source.amount &&
        currentTracker?.budgeted === tracker.budgeted - delta
      );
    });
    if (JSON.stringify(banksBefore) !== JSON.stringify(await snapshotBanks())) {
      fail(
        'Bank balances changed. Inspect Actual immediately; do not run reconciliation again.',
      );
    }
    Object.assign(plan, {
      applied: true,
      verified: true,
      actualAfter: await api.getAccountBalance(account.id),
    });
  }
  return plan;
}
