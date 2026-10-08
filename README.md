# Innovation Center Laser Queue

A small web app for submitting files to be laser cut at the Innovation Center.
Students upload an Adobe Illustrator (`.ai`) file; staff download submissions
from the queue page on the lab PC.

## Repository layout

```
web/        React + TypeScript + Vite frontend (/submit, /queue)
backend/    Lambda handlers (one file per API route)
infra/      AWS CDK stack: S3, DynamoDB, Lambda, HTTP API
```

The three folders are npm workspaces, so a single `npm install` at the root
installs everything.

## API

| Route                        | Handler                                  |
| ---------------------------- | ---------------------------------------- |
| `POST /jobs`                 | `backend/src/handlers/createJob.ts`      |
| `GET /jobs`                  | `backend/src/handlers/listJobs.ts`       |
| `GET /jobs/{jobId}/download` | `backend/src/handlers/getDownloadUrl.ts` |
| `POST /jobs/{jobId}/complete`| `backend/src/handlers/completeJob.ts`    |
| `DELETE /jobs/{jobId}`       | `backend/src/handlers/deleteJob.ts`      |

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
AWS locally.

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

## Frontend hosting

`amplify.yml` configures AWS Amplify Hosting to build the `web/` workspace.
When connecting the repository in the Amplify console, mark it as a monorepo
with app root `web`, set `VITE_API_URL` as an environment variable, and add a
rewrite so client-side routes load `index.html`.

See [production deployment](docs/production.md) for the production URLs,
administrator OIDC setup, and automatic deployment configuration.

## Security

- The S3 bucket is private; access is through presigned URLs only.
- Never commit AWS credentials or `.env` files.
- The app currently has no authentication in either environment. Anyone with
  its URL can view and manage submissions; production retains this access
  model for now.
