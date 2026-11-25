# Splitser sync

Dependency-light Node.js service that reconciles the user's Splitser net balance to an off-budget Actual account. Keep deployment names, account names, credentials, and infrastructure details out of this public repository.

## Checks

`npm run check` is the local CI gate: syntax, strict JavaScript typechecking, boundary lint, formatting, and tests. `npm test` uses fake backends and no credentials. `npm run reconcile` is a live dry run; only `npm run reconcile:apply` may write.

## Architecture

- `client.js`: Splitser authentication, cookie persistence, HTTP, caching.
- `http.js`: inbound HTTP authentication and response redaction.
- `reconcile.js`: reconciliation invariants and the only Actual mutations.
- `actual.js`: real API adapter and CLI.
- `server.js`: composition and scheduling.

Keep private cookie and Actual state in `/data` in containers. Reconciliation refuses unbooked bank imports, changed bank-reported balances, and pre-existing tracker drift.
