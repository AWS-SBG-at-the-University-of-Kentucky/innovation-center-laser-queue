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
  `infra/lib/laser-queue-stack.ts` and `web/src/api.ts`. Change both copies.
- Backend imports use `.js` extensions (`../lib/http.js`) because the backend
  is ESM. The frontend imports have no extensions.
- New Lambdas need explicit `grant*` calls in the stack, or they fail with
  AccessDenied at runtime.
- Never return `s3Key` from the API. Strip it to a `JobSummary`.

## Checks

```sh
npm run typecheck
npm run build
npm run synth
```
