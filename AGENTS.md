# Notes for AI coding assistants

Read `README.md`, `docs/architecture.md` and `CONTRIBUTING.md` first. They
describe the system and the step-by-step guides for common changes. This file
only lists rules and gotchas.

## Rules

- Don't deploy (`cdk deploy`, `npm run deploy*`) unless the user asks. Never
  deploy prod from a branch other than `main`.
- Never commit AWS credentials or `.env` files.
- Don't run `npm run reset:dev` without asking: it deletes every job and file
  in dev.

## Gotchas

- Job types and `ALLOWED_EXTENSIONS` are duplicated in `backend/src/types.ts`
  and `web/src/api.ts`. `MAX_FILE_SIZE_BYTES` is duplicated in
  `infra/lib/laser-queue-stack.ts` and `web/src/api.ts`. So is
  `QUEUED_JOB_MAX_AGE_DAYS`. Change both copies.
- Backend imports use `.js` extensions (`../lib/http.js`) because the backend
  is ESM. The frontend imports have no extensions.
- New Lambdas need explicit `grant*` calls in the stack, or they fail with
  AccessDenied at runtime.
- Never return `s3Key` from the API. Strip it to a `JobSummary`.
- Deleted jobs stay in the table as `ARCHIVED` records (timestamps only) for
  analytics. A new scan must skip them unless it's counting history.
- The `Analytics` response types are duplicated in `backend/src/types.ts` and
  `web/src/api.ts`. Change both copies.
- The Entra tenant and client IDs are duplicated in `web/src/auth.ts` and
  `infra/lib/laser-queue-stack.ts`. A new frontend origin must be added to
  `ALLOWED_ORIGINS` in the stack *and* as a SPA redirect URI in Entra.
- Every API handler must call `authorize()` from `backend/src/lib/auth.ts` first.
  Scheduled jobs (`backend/src/scheduled/`) have no caller and don't.
  The JWT authorizer only proves the token is valid; the handler checks the
  scope, guest status and `Staff` role. Never trust identity from the body.
- HTTP API JWT authorizers flatten array claims (`roles`) into strings like
  `"[Staff]"`. Use `listClaim()` in `lib/auth.ts`.

## Checks

```sh
npm run typecheck
npm run build
npm run synth
```
