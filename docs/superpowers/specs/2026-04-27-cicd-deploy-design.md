# CI/CD — Auto Deploy Backend to Railway

**Date:** 2026-04-27

## Goal

Auto-deploy the backend to Railway on every push to `main`, but only when:
1. The CI workflow passes
2. Backend-related files actually changed

## New File

`.github/workflows/deploy.yml`

## Trigger

Uses the `workflow_run` event. Fires when the `CI` workflow finishes on `main`. If CI failed, the deploy job is skipped immediately via an `if` condition.

## Jobs

### deploy

**Runs when:** CI passed (`workflow_run.conclusion == 'success'`)

**Steps:**

1. **Checkout** — `fetch-depth: 2` to allow a one-commit diff
2. **Check backend files changed** — `git diff HEAD~1 HEAD` filtered by:
   - `src/`
   - `migrations/`
   - `Cargo.toml`
   - `Cargo.lock`
   - `Dockerfile`
   - If nothing matched, remaining steps are skipped
3. **Install Railway CLI** — `npm install -g @railway/cli`
4. **Deploy** — `railway up --service sokopay`
   - Authenticates via `RAILWAY_TOKEN` GitHub secret
   - Uploads source, Railway builds using the existing Dockerfile
   - Blocks until deploy finishes (no `--detach`)

## Migrations

Migrations already run on app startup (`src/db/mod.rs`). No extra step needed.

## Secrets Required

| Secret | Where to get it |
|---|---|
| `RAILWAY_TOKEN` | Railway → Account Settings → Tokens |

Already added to GitHub repo secrets.

## What Does Not Change

- `main.yml` (CI) is unchanged
- Frontend deploy workflows are unchanged
- Dockerfile is unchanged
