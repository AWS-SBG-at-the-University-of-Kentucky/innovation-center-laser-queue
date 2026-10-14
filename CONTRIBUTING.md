# Contributing

Start with the [README](README.md) to get set up, then read
[docs/architecture.md](docs/architecture.md). Together they take about 15
minutes and cover everything below.

## Workflow

1. Branch off `main` (`git checkout -b short-description`).
2. Make your change. Deploy to dev if it touches `backend/` or `infra/`
   (`npm run deploy:dev`), and test it through the frontend.
3. Run `npm run typecheck` and `npm run build`. CI runs both, plus
   `npm run synth`.
4. Open a pull request into `main` and fill in the template.

Merging to `main` can deploy the production backend automatically (see
`.github/workflows/ci.yml`), so treat every merge as a release.

Never commit AWS credentials or `.env` files. `web/.env.local` is already
git-ignored.

## Where things live

| To change...                     | Look in                                  |
| -------------------------------- | ---------------------------------------- |
| A page's UI                      | `web/src/pages/`                         |
| Shared UI pieces                 | `web/src/components/`, `web/src/icons.tsx` |
| Styles                           | `web/src/index.css`                      |
| How the frontend calls the API   | `web/src/api.ts`                         |
| What an API route does           | `backend/src/handlers/`                  |
| Input rules (lengths, file types) | `backend/src/lib/validation.ts`          |
| The job record's fields          | `backend/src/types.ts` (and its copy in `web/src/api.ts`) |
| AWS resources, limits, permissions | `infra/lib/laser-queue-stack.ts`        |

## Common changes

### Add an API route

1. Create `backend/src/handlers/yourHandler.ts` exporting
   `handler: APIGatewayProxyHandlerV2`. Copy an existing handler for the
   pattern; use `json()` and `error()` from `lib/http.ts` for responses.
2. In `infra/lib/laser-queue-stack.ts`:
   - create the function with `handler("YourHandler", "yourHandler.ts")`,
   - grant only the access it needs (`table.grantReadData(...)`, etc.),
   - add the route with `api.addRoutes(...)`,
   - if it uses a new HTTP method, add it to `corsPreflight.allowMethods`.
3. Add a client function to `web/src/api.ts`.
4. Add the route to the API table in the README.
5. `npm run deploy:dev` and try it.

### Add a field to a job

1. Add it to `Job` in `backend/src/types.ts` **and** in `web/src/api.ts`.
2. Set it where jobs are created (`createJob.ts`) or updated.
3. If students supply it, validate it in `lib/validation.ts` and add it to
   `CreateJobRequest` in `web/src/api.ts`.
4. Existing records won't have the field, so make it optional or handle it
   being missing.

### Allow another file type

Add the extension to `ALLOWED_EXTENSIONS` in both `backend/src/types.ts` and
`web/src/api.ts`. The file picker and error messages pick it up from there.

### Change the file-size limit or URL expiry

Edit `MAX_FILE_SIZE_BYTES` or `URL_EXPIRY_SECONDS` at the top of
`infra/lib/laser-queue-stack.ts`. For the size limit, also update the copy in
`web/src/api.ts` so the frontend shows the right number.

### Add a page

Create it in `web/src/pages/` and add a `<Route>` in `web/src/App.tsx`.
Amplify's rewrite rule already sends every path to `index.html`.

## Keeping the docs current

If your change makes something in the README, `docs/architecture.md` or this
file wrong, fix it in the same PR. Docs explain *why* and *how things connect*.
For exact values (field lists, limits, permissions), point to the file that
defines them instead of copying it, so there's only one place to update.
