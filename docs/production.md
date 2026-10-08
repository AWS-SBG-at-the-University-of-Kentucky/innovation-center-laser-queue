# Production deployment

AWS account: `579730595819`; region: `us-east-2`.

| Resource | Production |
| --- | --- |
| Backend stack | `LaserQueue-prod` |
| API | `https://250zgm8jl4.execute-api.us-east-2.amazonaws.com` |
| Amplify app | `innovation-center-laser-queue-prod` (`d3qsl3joaqr525`) |
| Frontend | `https://main.d3qsl3joaqr525.amplifyapp.com` |

Production has separate S3 and DynamoDB resources from development. The
production stack has termination protection, and its table has deletion
protection and point-in-time recovery. Existing data resources retain CDK's
default retain-on-deletion policy. Development is left in place.

The initial frontend deployment is manual. Git-connected frontend deployment
and the backend GitHub deployment identity still need the setup below. The
app remains unauthenticated, as requested; its URL permits queue access and
submission management. CORS currently allows all origins.

## Backend: administrator setup

The organization's service control policy
`p-gl0jtuzh` blocks `iam:CreateOpenIDConnectProvider` in this account. An AWS
organization administrator must permit this operation and deploy the template
with an authorized identity. Changing an account IAM policy alone cannot
override an organization deny.

```sh
aws cloudformation deploy \
  --template-file infra/github-oidc.yml \
  --stack-name LaserQueue-GitHubDeploy \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-2 \
  --profile innovation-center
```

If the account already has the GitHub OIDC provider, add
`--parameter-overrides CreateProvider=false`. Do not create a second provider.
The template trusts only pushes from this repository's `main` branch, with
audience `sts.amazonaws.com`. It allows assuming the existing CDK deployment,
file-publishing, and lookup roles in this account and region. The bootstrap
deployment role provides broad infrastructure deployment capabilities; review
and protect changes merged to `main` accordingly.

After the stack succeeds, enable the deployment job by setting this repository
variable (it is a role ARN, not a secret):

```sh
gh variable set AWS_DEPLOY_ROLE_ARN \
  --repo AWS-SBG-at-the-University-of-Kentucky/innovation-center-laser-queue \
  --body arn:aws:iam::579730595819:role/LaserQueue-prod-GitHubDeploy
```

`.github/workflows/ci.yml` runs type checks, the frontend build, and production
CDK synthesis on PRs and pushes to `main`. The deployment job is skipped until
the variable is configured. After that, successful checks on pushes to `main`
deploy only `LaserQueue-prod` and check `GET /jobs`. Production deployments are
serialized and running deployments are not canceled by newer pushes. PRs
never receive AWS deployment credentials.

Merge the CI PR and push a change to `main` to verify the first OIDC deployment.
Do not mark automatic backend deployment verified until that run succeeds.

## Frontend: connect Amplify to GitHub

The GitHub organization disables deploy keys, so the CLI's existing OAuth
session cannot connect the repository. Authorize the AWS Amplify GitHub App
for `AWS-SBG-at-the-University-of-Kentucky/innovation-center-laser-queue` through
the Amplify console. Connect the production app to `main` and enable automatic
builds. If the console requires creating a new Git-connected app, use the same
settings below, verify it first, and update this document with its app ID/URL
before removing the manual production host.

- Platform: static web; branch: `main`; app root: `web`.
- `AMPLIFY_MONOREPO_APP_ROOT=web`.
- `VITE_API_URL=https://250zgm8jl4.execute-api.us-east-2.amazonaws.com`.
- Use the repository's `amplify.yml`: Node 24, root workspace install/build,
  artifacts in `web/dist`.
- SPA rewrite, status `200`, target `/index.html`:
  `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>`.

Amplify auto-builds independently of backend CI. Backend deployment waits for
GitHub checks; frontend auto-builds do not wait for backend deployment. Keep API
changes compatible with the frontend during rollout.

Verify direct `/submit` and `/queue` loads and an upload/download/complete/delete
flow against production. Keep the dev Amplify app (`d2hfh1gudm3mwn`) until the
production flow and both automatic deployment paths have been verified and
its removal is authorized.
