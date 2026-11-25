# Splitser sync for Actual Budget

Read-only Splitser web API client plus an optional, opt-in balance reconciler for [Actual Budget](https://actualbudget.org/). No Chromium is needed. This project uses Splitser's private web API, which may change without notice.

**For your own setup, start with the dry run. It never writes to Splitser, and it writes to Actual only when explicitly requested.**

## Local setup

Requires Node.js 22 or newer. This checkout is pinned to Actual API 26.11.0; keep that version equal to your Actual server version.

```sh
cp .env.example .env
# Fill in the Splitser and Actual settings in .env.
npm ci
npm run reconcile
```

The dry run reads your exact member balance from every active Splitser list and compares it with the named off-budget Actual account and tracker category. The invariant is:

```text
tracker category balance = -Splitser account balance
```

After reviewing it, a one-time write is explicit:

```sh
npm run reconcile -- --apply
```

Every apply first syncs the linked ING accounts through Actual. If it imports new transactions or bank balances change, reconciliation stops so the normal bookkeeping workflow can book them first. This adds one off-budget adjustment with the stable `imported_id` `splitser:balance:current`, or updates the existing adjustment on later runs. It also adjusts the current month's tracker budget by the opposite amount. Existing bank-imported settlements and their transfers are left alone. The command refuses pre-existing tracker drift, verifies both balances after writing, and checks that bank-synced account balances did not change.

## API

```sh
npm start
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/lists
curl http://127.0.0.1:8787/balances
curl 'http://127.0.0.1:8787/transactions?list_id=LIST_UUID'
```

Transactions include expenses, income, and settlements, deduplicated by `type:id`. Balances are the lean reconciliation source: one request per list rather than downloading full histories. List metadata is cached for 60 seconds and balances/transactions for 5 minutes, with cache invalidation based on Splitser's list timestamps. Concurrent requests share in-flight calls. `?refresh=1` bypasses caches.

A saved session is used until rejected or expired, then the client signs in with `SPLITSER_EMAIL` and `SPLITSER_PASSWORD`, saves the replacement cookie atomically, and retries once. Concurrent logins are shared.

For a public Coolify deployment, set `API_TOKEN` to a long random token; all non-health endpoints then require `Authorization: Bearer <token>`. Without it, bind the API only to localhost or a private network.

## Actual reconciliation endpoint

Set a separate random `RECONCILE_TOKEN`, then:

```sh
curl -X POST -H "Authorization: Bearer $RECONCILE_TOKEN" \
  http://127.0.0.1:8787/reconcile
```

This is still a dry run. To allow `?apply=true`, explicitly set `ALLOW_ACTUAL_WRITES=true`. Overlapping runs return HTTP 409.

For automatic reconciliation in Coolify, set `RECONCILE_INTERVAL_MINUTES=60` (or your preferred interval) and `ALLOW_ACTUAL_WRITES=true`. The service reconciles on startup and at that interval. Do not schedule it until a manual dry run and a reviewed one-time apply have succeeded.

## Coolify / Docker

Deploy this directory as a Docker Compose application. Configure secrets in Coolify rather than committing `.env`. The `splitser-data` volume stores the refreshed session and Actual's local budget cache. The Compose port is localhost-only; remove or adjust it when using Coolify's private network or authenticated reverse proxy.

`.env`, cookies, the local Actual cache, and reconciliation reports are ignored by Git and excluded from Docker build context.

## GitHub preparation

This directory is self-contained and can be moved to its own repository. Before publishing, create a fresh repository with no inherited Git history, verify the ignore rules, and rotate any credentials or cookies previously pasted into chat or shell commands. This first version is tailored to a single Splitser member, one off-budget account, and one carryover tracker category; those are configurable through `.env`.
