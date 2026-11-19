# Architecture

How the pieces fit together, and why they are built this way. For setup and
commands, see the [README](../README.md). For how to make changes, see
[CONTRIBUTING](../CONTRIBUTING.md).

## Overview

```mermaid
flowchart LR
  Browser["Browser<br/>(web/, hosted on Amplify)"]
  Entra["Microsoft Entra ID<br/>(UK tenant)"]
  API["HTTP API<br/>(API Gateway + JWT authorizer)"]
  Lambdas["Lambda handlers<br/>(backend/src/handlers)"]
  DDB[("DynamoDB<br/>LaserJobs table")]
  S3[("S3<br/>JobFiles bucket")]

  Browser -- sign in --> Entra
  Browser -- "JSON requests<br/>+ access token" --> API --> Lambdas
  Lambdas -- job records --> DDB
  Lambdas -- presigned URLs --> S3
  Browser -- "file upload / download<br/>(presigned URL)" --> S3
```

There are three pages:

- **`/submit`** (`web/src/pages/SubmitPage.tsx`): signed-in students upload an
  `.ai` file. Their name comes from their UK account. The page shows how
  many jobs are in line and, after submitting, the student's place in line.
- **`/queue`** (`web/src/pages/QueuePage.tsx`): staff on the lab PC see every
  job, download files, mark jobs completed, and delete completed jobs.
- **`/analytics`** (`web/src/pages/AnalyticsPage.tsx`): staff see how much the
  laser gets used: totals, records, a calendar heat map and talking points.

All pages are behind sign-in (`web/src/components/AuthGate.tsx`). Staff get
links to all three in the top bar (`StaffNav.tsx`); students only have
`/submit`, so they get no links.

All AWS resources are defined in one CDK stack,
`infra/lib/laser-queue-stack.ts`. It is deployed twice, as `LaserQueue-dev` and
`LaserQueue-prod`.

## Job lifecycle

```mermaid
sequenceDiagram
  participant S as Student (/submit)
  participant API as API + Lambda
  participant DB as DynamoDB
  participant B as S3
  participant T as Staff (/queue)

  S->>API: POST /jobs {fileName, fileSize} + token
  API->>DB: put job (status QUEUED), count queue
  API-->>S: {jobId, uploadUrl, position}
  S->>B: PUT file to uploadUrl
  T->>API: GET /jobs
  API-->>T: all jobs, oldest first
  T->>API: GET /jobs/{id}/download
  API-->>T: {downloadUrl}
  T->>B: GET file
  T->>API: POST /jobs/{id}/complete
  API->>DB: status COMPLETED, set completedAt
  T->>API: DELETE /jobs/{id}
  API->>B: delete file
  API->>DB: status ARCHIVED, remove name and file name
```

A job is `QUEUED`, then `COMPLETED`, then `ARCHIVED` once staff delete it.
Only completed jobs can be deleted. Deleting removes the file, the student's
name and the file name, but keeps the record's timestamps so analytics can
still count the job. Archived jobs never appear in `GET /jobs` and can't be
downloaded or completed again.

## Weekly cleanup

`backend/src/scheduled/cleanup.ts` runs every Sunday at 3 AM Eastern
(EventBridge Scheduler, `WeeklyCleanupSchedule` in the stack). It archives
jobs exactly as the delete button does (`archiveJob()` in `lib/jobs.ts`):

- every `COMPLETED` job staff didn't delete, and
- every `QUEUED` job older than `QUEUED_JOB_MAX_AGE_DAYS` (14). These are
  treated as abandoned: the student left, or the upload never finished. They
  are archived without a `completedAt`, so analytics counts them as expired,
  not cut.

It isn't an API route, so it doesn't call `authorize()`: only the scheduler
can invoke it. If any job fails, the run fails and the scheduler retries it
(up to twice); archived jobs are skipped, so a retry only picks up what's
left. Its logs are in CloudWatch under the `WeeklyCleanup` function.

As a backstop, an S3 lifecycle rule deletes any file under `jobs/` older than
`FILE_MAX_AGE_DAYS` (30). No job can legitimately keep its file that long (14
days queued plus up to a week until the next cleanup), so the rule only
catches files the cleanup missed.

## Authentication

Users sign in with Microsoft Entra ID using the app registration **Innovation
Center Queue** in the University of Kentucky tenant. There is no Cognito and
no client secret: the browser gets tokens straight from Entra, and API Gateway
checks them.

```mermaid
sequenceDiagram
  participant B as Browser
  participant E as Entra ID (UK tenant)
  participant G as API Gateway (JWT authorizer)
  participant L as Lambda (lib/auth.ts)

  B->>E: sign in (redirect, MSAL)
  E-->>B: ID token + access token for api://<client-id>/access_as_user
  B->>G: request with Authorization: Bearer <access token>
  G->>G: check signature, expiry, issuer (UK tenant), audience (client ID)
  G->>L: request + token claims
  L->>L: check scope, member (not guest), Staff role if needed
```

Checks happen in two layers:

1. **API Gateway** (`HttpJwtAuthorizer` in `infra/lib/laser-queue-stack.ts`)
   is the default authorizer for every route. It rejects requests without a
   valid token from the UK tenant issued for this app with **401**, before any
   Lambda runs.
2. **The handler** calls `authorize()` from `backend/src/lib/auth.ts` first. It
   requires the `access_as_user` scope and `acct = 0` (a tenant member, not an
   invited guest). For staff routes it also requires the `Staff` app role.
   Failures return **403**.

The frontend (`web/src/auth.ts`) uses `@azure/msal-browser` with redirect
sign-in. MSAL clears its own token cache when the browser closes.

**Staying signed in (lab PC).** The sign-in page has a "Keep this computer
signed in" checkbox. It sets a `localStorage` flag that makes the site sign in
automatically on every load. If the user also chose "Stay signed in" at
Microsoft, Microsoft's persistent cookie lets that redirect come straight back
without a password, so a browser restart needs no clicks at all. Signing out
clears both. How long Microsoft's cookie lasts is set by UK IT's policies,
not by this app. `request()` in `web/src/api.ts` attaches a fresh access
token to every call. The queue page hides itself from non-staff, but that's
only for a friendlier message: the API enforces the role either way.

`createJob` takes the student's name from the token, not from the request
body, so nobody can submit a job under someone else's name. The name is the
only personal detail stored with a job. `authorize()` still reads the linkblue
`preferred_username` and Entra object ID to check the caller, but they are not
saved. The frontend shows the student their own email from MSAL so they know
which account they're on.

Entra settings this depends on (app registration unless noted):

- **Authentication:** Single-page application redirect URIs for every frontend
  origin (the Amplify URL and `http://localhost:5173`).
- **Expose an API:** scope `access_as_user`.
- **Manifest:** `requestedAccessTokenVersion: 2`. With v1 tokens the issuer
  doesn't match and every request gets 401.
- **App roles:** `Staff`, assigned to people under Enterprise applications.
- **Token configuration:** optional claims `acct` and `email` on the access
  token. Without `acct`, every request is rejected (it fails closed).

## Data model

The job record is defined in [`backend/src/types.ts`](../backend/src/types.ts).
That file is the source of truth for its fields.

- **DynamoDB**: one table, partition key `jobId` (a UUID), no secondary
  indexes.
- **S3**: one private bucket. Each file is stored at
  `jobs/{jobId}/{sanitized file name}`.
- **API responses** use `JobSummary`, which is the job without `s3Key`. Bucket
  paths never leave the backend.
- **Archived jobs** (`ArchivedJob`) share the table. Anything that scans it
  must decide whether to skip them, as `GET /jobs` does. An archived job with
  no `completedAt` expired in the queue without being cut.

`web/src/api.ts` keeps its own copy of these types, because the frontend
doesn't import from `backend/`. If you change one, change the other.

## Design decisions

**Files never pass through Lambda.** Lambda and API Gateway have small payload
limits, and streaming large files through them costs money for no benefit. The
API hands out presigned S3 URLs that expire after a few minutes
(`URL_EXPIRY_SECONDS` in the stack), and the browser talks to S3 directly.

**The file-size limit is enforced by S3, not by the frontend.** `createJob`
signs the upload URL with the exact `Content-Length` the client declared, so S3
rejects an upload of any other size. The frontend also checks the size, but
only to show a friendlier error.

**The job record is written before the file is uploaded.** If a student closes
the tab mid-upload, a `QUEUED` job with no file is left behind. `getDownloadUrl`
checks for the file first and returns a clear 404 when it's missing.

**Delete removes the file first, then archives the record.** If the S3 delete
fails, the record is still there and staff can retry. Doing it the other way
round could leave files in S3 that nothing points to.

**Deleted jobs are archived, not removed.** Analytics needs every job ever cut,
and staff delete completed jobs to tidy the queue. Archiving keeps only the
timestamps, so nothing personal outlives the delete.

**Analytics are counted on the server, in the lab's time zone.**
`GET /analytics` (`backend/src/lib/analytics.ts`) rolls jobs up into counts
per day in `America/New_York`, so a job cut at 10 PM lands on the right day
whatever time zone the viewer is in, and the response stays small as history
grows. The page (`web/src/analytics.ts`) works out weeks, months and records
from those daily counts. A "cut" is a job marked completed, counted on the day
it was completed.

**`GET /jobs` scans the whole table**, and so do `GET /queue/length`,
`GET /analytics`, the weekly cleanup and `createJob` (to count the queue). That's fine at lab scale (hundreds of
jobs). If the table ever grows large, add a secondary index on `status` or
`createdAt` and query that instead.

**Authorization is checked in two places on purpose.** The JWT authorizer
can't check app roles (only scopes), so the role check lives in the handlers.
Making the authorizer the API's default means a new route can't be added
without sign-in by accident.

**Each Lambda gets only the permissions it needs.** See the `grant*` calls in
the stack: for example, `listJobs` can only read the table.

**Configuration comes from environment variables.** The stack sets
`TABLE_NAME`, `BUCKET_NAME`, `MAX_FILE_SIZE_BYTES` and `URL_EXPIRY_SECONDS` on
every Lambda, and `backend/src/lib/config.ts` reads them. Nothing in
`backend/` hard-codes resource names.

**Local development uses the real dev stack.** There's no local AWS emulator.
`npm run dev` runs the frontend against the deployed `LaserQueue-dev` API, and
`npm run reset:dev` empties it. The reset script refuses to touch any stack
other than dev.

**Prod is protected against accidental deletion.** The prod stack has
termination protection, and its table has deletion protection and
point-in-time recovery. Dev has neither, so it can be torn down freely.

## Known limitations

- **Any UK member can submit, not only students.** Faculty and staff accounts
  can sign in too. Restricting to students would need a student group from UK
  IT ("Assignment required" on the enterprise app).
- **New staff must sign out and back in** before `/queue` works, because the
  role is read from their token.
- **No automated tests for the app itself.** CI type-checks every workspace,
  builds the frontend and synthesizes the CDK stack. Only `scripts/deploy.mjs`
  has tests.
- **Analytics only go back to this feature's release.** Before it, deleting a
  job removed its record, so jobs deleted earlier aren't counted. Jobs that
  were still in the table then are.
- **The queue page doesn't update on its own.** Staff press Refresh to see new
  submissions.
