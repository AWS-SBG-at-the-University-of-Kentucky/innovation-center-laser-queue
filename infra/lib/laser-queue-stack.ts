import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import {
  HttpJwtAuthorizer,
  HttpLambdaAuthorizer,
  HttpLambdaResponseType,
} from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import type { Construct } from "constructs";

const BACKEND_SRC = path.join(import.meta.dirname, "../../backend/src");
const HANDLERS_DIR = path.join(BACKEND_SRC, "handlers");

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const URL_EXPIRY_SECONDS = 300;

// The weekly cleanup (backend/src/scheduled/cleanup.ts) clears completed jobs
// and expires queued jobs older than this. Mirrored in web/src/api.ts.
const QUEUED_JOB_MAX_AGE_DAYS = 14;
// Backstop for files the cleanup never reaches (an upload whose record is
// gone, or a cleanup that kept failing). Longer than any job can legitimately
// wait: at most QUEUED_JOB_MAX_AGE_DAYS plus a week until the next cleanup.
const FILE_MAX_AGE_DAYS = 30;

// The Entra ID app registration "Innovation Center Queue" in the University of
// Kentucky tenant. Neither value is a secret. Mirrored in web/src/auth.ts.
const ENTRA_TENANT_ID = "2b30530b-69b6-4457-b818-481cb53d42ae";
const ENTRA_CLIENT_ID = "eae4e6cc-becd-41cb-906c-e68c5ea58ff0";

// Headers a lab station signs its requests with. Mirrored in
// backend/src/lib/stations.ts and web/src/station.ts.
const STATION_HEADERS = [
  "x-station-id",
  "x-station-time",
  "x-station-signature",
];

// Sites allowed to call the API and S3 from a browser: the Amplify app and the
// Vite dev server. Each must also be a redirect URI on the app registration.
const ALLOWED_ORIGINS = [
  "https://main.d2x8cagoebgbb3.amplifyapp.com",
  "http://localhost:5173",
];

export class LaserQueueStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const isProd = this.node.tryGetContext("stage") === "prod";

    const bucket = new s3.Bucket(this, "JobFiles", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // The browser uploads to and downloads from S3 directly via presigned URLs.
      lifecycleRules: [
        {
          id: "ExpireOldJobFiles",
          prefix: "jobs/",
          expiration: cdk.Duration.days(FILE_MAX_AGE_DAYS),
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ALLOWED_ORIGINS,
          allowedHeaders: ["*"],
        },
      ],
    });

    const table = new dynamodb.Table(this, "LaserJobs", {
      partitionKey: { name: "jobId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      ...(isProd
        ? {
            deletionProtection: true,
            pointInTimeRecoverySpecification: {
              pointInTimeRecoveryEnabled: true,
            },
          }
        : {}),
    });

    // PCs allowed to use the queue without anyone signed in (the lab PC). Kept
    // apart from LaserJobs so job scans never see them.
    const stationsTable = new dynamodb.Table(this, "LabStations", {
      partitionKey: { name: "stationId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      deletionProtection: isProd,
    });

    const fn = (id: string, entry: string, timeout = cdk.Duration.seconds(10)) =>
      new NodejsFunction(this, id, {
        entry,
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        timeout,
        environment: {
          TABLE_NAME: table.tableName,
          STATIONS_TABLE_NAME: stationsTable.tableName,
          BUCKET_NAME: bucket.bucketName,
          MAX_FILE_SIZE_BYTES: String(MAX_FILE_SIZE_BYTES),
          URL_EXPIRY_SECONDS: String(URL_EXPIRY_SECONDS),
          QUEUED_JOB_MAX_AGE_DAYS: String(QUEUED_JOB_MAX_AGE_DAYS),
        },
      });
    // An API route's Lambda.
    const handler = (id: string, file: string) =>
      fn(id, path.join(HANDLERS_DIR, file));

    const createJob = handler("CreateJob", "createJob.ts");
    // Read as well as write: it counts the queue to tell the student their place.
    table.grantReadWriteData(createJob);
    bucket.grantPut(createJob);

    const listJobs = handler("ListJobs", "listJobs.ts");
    table.grantReadData(listJobs);

    // Staff analytics: reads timestamps only, across every job ever submitted.
    const getAnalytics = handler("GetAnalytics", "getAnalytics.ts");
    table.grantReadData(getAnalytics);

    const getQueueLength = handler("GetQueueLength", "getQueueLength.ts");
    table.grantReadData(getQueueLength);

    const getDownloadUrl = handler("GetDownloadUrl", "getDownloadUrl.ts");
    table.grantReadData(getDownloadUrl);
    bucket.grantRead(getDownloadUrl);

    const completeJob = handler("CompleteJob", "completeJob.ts");
    table.grantWriteData(completeJob);

    const deleteJob = handler("DeleteJob", "deleteJob.ts");
    // Read and write: deleting archives the record rather than removing it.
    table.grantReadWriteData(deleteJob);
    bucket.grantDelete(deleteJob);

    // Lab station management: staff signed in with Entra only.
    const listStations = handler("ListStations", "listStations.ts");
    stationsTable.grantReadData(listStations);

    const createStation = handler("CreateStation", "createStation.ts");
    // Read as well as write: it counts stations against the limit.
    stationsTable.grantReadWriteData(createStation);

    const deleteStation = handler("DeleteStation", "deleteStation.ts");
    stationsTable.grantWriteData(deleteStation);

    // Weekly cleanup, Sundays at 3 AM in the lab's time zone. Archives jobs
    // exactly like DELETE /jobs/{jobId}, so it needs the same access.
    const cleanup = fn(
      "WeeklyCleanup",
      path.join(BACKEND_SRC, "scheduled/cleanup.ts"),
      cdk.Duration.minutes(5),
    );
    table.grantReadWriteData(cleanup);
    bucket.grantDelete(cleanup);
    new scheduler.Schedule(this, "WeeklyCleanupSchedule", {
      description:
        "Clears completed jobs and expires stale queued jobs, keeping anonymous records for analytics.",
      schedule: scheduler.ScheduleExpression.cron({
        weekDay: "SUN",
        hour: "3",
        minute: "0",
        timeZone: cdk.TimeZone.AMERICA_NEW_YORK,
      }),
      target: new LambdaInvoke(cleanup, { retryAttempts: 2 }),
    });

    // Every route requires an Entra access token issued by the UK tenant for
    // this app. Handlers then check scope, guest status and the Staff role
    // (backend/src/lib/auth.ts). CORS preflight requests skip the authorizer.
    const authorizer = new HttpJwtAuthorizer(
      "EntraAuthorizer",
      `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0`,
      { jwtAudience: [ENTRA_CLIENT_ID] },
    );

    // The /station/* routes are for the lab PC, which has no Microsoft sign-in.
    // This checks the request was signed by a registered station's key
    // (backend/src/authorizers/station.ts). Not cached, so removing a station
    // takes effect on its next request.
    const stationAuthorizerFn = fn(
      "StationAuthorizer",
      path.join(BACKEND_SRC, "authorizers/station.ts"),
    );
    // Write as well as read: it records when each station was last used.
    stationsTable.grantReadWriteData(stationAuthorizerFn);
    const stationAuthorizer = new HttpLambdaAuthorizer(
      "LabStationAuthorizer",
      stationAuthorizerFn,
      {
        responseTypes: [HttpLambdaResponseType.SIMPLE],
        identitySource: STATION_HEADERS.map((h) => `$request.header.${h}`),
        resultsCacheTtl: cdk.Duration.seconds(0),
      },
    );

    const api = new apigwv2.HttpApi(this, "Api", {
      defaultAuthorizer: authorizer,
      corsPreflight: {
        allowOrigins: ALLOWED_ORIGINS,
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["authorization", "content-type", ...STATION_HEADERS],
      },
    });

    api.addRoutes({
      path: "/jobs",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration("CreateJobIntegration", createJob),
    });
    api.addRoutes({
      path: "/jobs",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration("ListJobsIntegration", listJobs),
    });
    api.addRoutes({
      path: "/queue/length",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "GetQueueLengthIntegration",
        getQueueLength,
      ),
    });
    api.addRoutes({
      path: "/analytics",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "GetAnalyticsIntegration",
        getAnalytics,
      ),
    });
    api.addRoutes({
      path: "/jobs/{jobId}/download",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "GetDownloadUrlIntegration",
        getDownloadUrl,
      ),
    });
    api.addRoutes({
      path: "/jobs/{jobId}/complete",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "CompleteJobIntegration",
        completeJob,
      ),
    });
    api.addRoutes({
      path: "/jobs/{jobId}",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new HttpLambdaIntegration("DeleteJobIntegration", deleteJob),
    });

    api.addRoutes({
      path: "/stations",
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "ListStationsIntegration",
        listStations,
      ),
    });
    api.addRoutes({
      path: "/stations",
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "CreateStationIntegration",
        createStation,
      ),
    });
    api.addRoutes({
      path: "/stations/{stationId}",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new HttpLambdaIntegration(
        "DeleteStationIntegration",
        deleteStation,
      ),
    });

    // The queue routes again, for lab stations. Same handlers; they call
    // authorize() with allowStation. Each route needs its own integration:
    // a shared one only grants API Gateway permission for its first path.
    const stationRoutes = [
      { path: "/station/jobs", method: apigwv2.HttpMethod.GET, target: listJobs },
      {
        path: "/station/jobs/{jobId}/download",
        method: apigwv2.HttpMethod.GET,
        target: getDownloadUrl,
      },
      {
        path: "/station/jobs/{jobId}/complete",
        method: apigwv2.HttpMethod.POST,
        target: completeJob,
      },
      {
        path: "/station/jobs/{jobId}",
        method: apigwv2.HttpMethod.DELETE,
        target: deleteJob,
      },
    ];
    for (const route of stationRoutes) {
      api.addRoutes({
        path: route.path,
        methods: [route.method],
        authorizer: stationAuthorizer,
        integration: new HttpLambdaIntegration(
          `Station${route.target.node.id}Integration`,
          route.target,
        ),
      });
    }

    // Goes in web/.env.local as VITE_API_URL.
    new cdk.CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
  }
}
