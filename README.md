# Innovation Center Laser Queue

A small web app for submitting files to be laser cut at the Innovation Center.
Students sign in with their UK account and upload an Adobe Illustrator (`.ai`)
file; staff download submissions from the queue page on the lab PC.

New to the project? Read this file for setup, then
[docs/architecture.md](docs/architecture.md) for how it works and
[CONTRIBUTING.md](CONTRIBUTING.md) for how to make changes.

## Repository layout

```
web/        React + TypeScript + Vite frontend (/submit, /queue, /analytics)
backend/    Lambda handlers (one file per API route)
infra/      AWS CDK stack: S3, DynamoDB, Lambda, HTTP API
```

The three folders are npm workspaces, so a single `npm install` at the root
installs everything.

## API

| Route                        | Who can call it | Handler                                  |
| ---------------------------- | --------------- | ---------------------------------------- |
| `POST /jobs`                 | Any UK member   | `backend/src/handlers/createJob.ts`      |
| `GET /queue/length`          | Any UK member   | `backend/src/handlers/getQueueLength.ts` |
| `GET /jobs`                  | Staff           | `backend/src/handlers/listJobs.ts`       |
| `GET /jobs/{jobId}/download` | Staff           | `backend/src/handlers/getDownloadUrl.ts` |
| `POST /jobs/{jobId}/complete`| Staff           | `backend/src/handlers/completeJob.ts`    |
| `DELETE /jobs/{jobId}`       | Staff           | `backend/src/handlers/deleteJob.ts`      |
| `GET /analytics`             | Staff           | `backend/src/handlers/getAnalytics.ts`   |

Every route needs a Microsoft Entra ID access token in an
`Authorization: Bearer` header. See "Authentication" in
[docs/architecture.md](docs/architecture.md#authentication).

Files never pass through Lambda: the browser uploads to and downloads from S3
directly using short-lived presigned URLs.

## Setup

Prerequisites: Git, Node.js 24 (see `.nvmrc`), and AWS CLI v2. The CDK CLI is
installed as a dev dependency, so no global install is needed.

```sh
git clone https://github.com/AWS-SBG-at-the-University-of-Kentucky/innovation-center-laser-queue
cd innovation-center-laser-queue
npm install
```

### Run the frontend

```sh
cp web/.env.example web/.env.local   # then set VITE_API_URL
npm run dev
```

Local frontends point at the shared development backend rather than emulating
AWS locally. Sign in with your UK account. To see `/queue` and `/analytics`
you need the `Staff` app role (see [Sign-in](#sign-in-microsoft-entra-id)). Run the dev server on
the default port 5173: it's the only local address registered for sign-in.

### Deploy the backend

Deploying needs access to the project's development AWS account through IAM
Identity Center:

```sh
aws configure sso --profile innovation-center
aws sts get-caller-identity --profile innovation-center
```

```sh
npm run synth -- --profile innovation-center
npm run deploy:dev
npm run deploy:prod
```

These commands deploy the current checkout to `LaserQueue-dev` or
`LaserQueue-prod` in `us-east-2`, using the `innovation-center` AWS profile.
Production deployment requires the current branch to be `main`. To explicitly
override the warning on another branch (including detached HEAD):

```sh
npm run deploy:prod -- --allow-non-main
```

If your AWS session has expired, sign in with
`aws login --profile innovation-center` before deploying. The lower-level
`npm run deploy -- ...` command remains available and does not apply this
branch guard.

The deploy prints an `ApiUrl` output; that is the value for `VITE_API_URL`.

The account must be bootstrapped once (usually by the project lead):

```sh
cd infra && npx cdk bootstrap --profile innovation-center
```

### Other commands

```sh
npm run typecheck   # type-check all three workspaces
npm run build       # production build of the frontend
```

## Sign-in (Microsoft Entra ID)

Sign-in uses the Entra ID app registration **Innovation Center Queue** in the
University of Kentucky tenant. Its tenant and client IDs are in
`web/src/auth.ts` and `infra/lib/laser-queue-stack.ts` (they aren't secrets).

- **Giving someone staff access:** Entra admin center → Enterprise
  applications → Innovation Center Queue → Users and groups → Add
  user/group, role `Staff`. They must sign out and back in afterwards.
- **Lab PC:** sign in with "Keep this computer signed in" ticked and answer
  **Yes** to Microsoft's "Stay signed in?". Don't tick it on shared or public
  computers.
- **Adding a new frontend URL** (for example an Amplify preview branch): add
  it as a *Single-page application* redirect URI on the app registration
  (Authentication), **and** to `ALLOWED_ORIGINS` in
  `infra/lib/laser-queue-stack.ts`, then redeploy the backend.

## Frontend hosting

`amplify.yml` configures AWS Amplify Hosting to build the `web/` workspace.
When connecting the repository in the Amplify console, mark it as a monorepo
with app root `web`, set `VITE_API_URL` as an environment variable, and add a
rewrite so client-side routes load `index.html`.

## Security

- The S3 bucket is private; access is through presigned URLs only.
- Never commit AWS credentials or `.env` files.
- Every API route requires a UK Entra ID sign-in. Guest accounts are
  rejected, and only users with the `Staff` app role can view, download,
  complete or delete jobs.
- The student's name is taken from their sign-in, not typed in. It is the
  only personal detail stored: emails and Entra IDs are not saved. Jobs from
  before that change can be cleaned up with
  `npm run strip-student-ids -- --stage <dev|prod> --profile <aws-profile>`.
- Students can see how many jobs are waiting (`GET /queue/length`) and their
  own place in line, but never other students' names or files.
- Deleting a job removes its file, the student's name and the file name. Only
  its timestamps are kept, so `/analytics` can still count it.
- Every Sunday at 3 AM Eastern a cleanup does the same to completed jobs staff
  didn't delete and to queued jobs older than 14 days. S3 also deletes any
  uploaded file older than 30 days, as a backstop.
