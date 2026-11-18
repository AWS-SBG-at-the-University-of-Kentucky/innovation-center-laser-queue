import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

const HANDLERS_DIR = path.join(
  import.meta.dirname,
  "../../backend/src/handlers",
);

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const URL_EXPIRY_SECONDS = 300;

// The Entra ID app registration "Innovation Center Queue" in the University of
// Kentucky tenant. Neither value is a secret. Mirrored in web/src/auth.ts.
const ENTRA_TENANT_ID = "2b30530b-69b6-4457-b818-481cb53d42ae";
const ENTRA_CLIENT_ID = "eae4e6cc-becd-41cb-906c-e68c5ea58ff0";

// Sites allowed to call the API and S3 from a browser: the Amplify app and the
// Vite dev server. Each must also be a redirect URI on the app registration.
const ALLOWED_ORIGINS = [
  "https://main.d2x8cagoebgbb3.amplifyapp.com",
  "http://localhost:5173",
];

export class LaserQueueStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, "JobFiles", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // The browser uploads to and downloads from S3 directly via presigned URLs.
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
      ...(this.node.tryGetContext("stage") === "prod"
        ? {
            deletionProtection: true,
            pointInTimeRecoverySpecification: {
              pointInTimeRecoveryEnabled: true,
            },
          }
        : {}),
    });

    const handler = (id: string, file: string) =>
      new NodejsFunction(this, id, {
        entry: path.join(HANDLERS_DIR, file),
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        timeout: cdk.Duration.seconds(10),
        environment: {
          TABLE_NAME: table.tableName,
          BUCKET_NAME: bucket.bucketName,
          MAX_FILE_SIZE_BYTES: String(MAX_FILE_SIZE_BYTES),
          URL_EXPIRY_SECONDS: String(URL_EXPIRY_SECONDS),
        },
      });

    const createJob = handler("CreateJob", "createJob.ts");
    // Read as well as write: it counts the queue to tell the student their place.
    table.grantReadWriteData(createJob);
    bucket.grantPut(createJob);

    const listJobs = handler("ListJobs", "listJobs.ts");
    table.grantReadData(listJobs);

    const getQueueLength = handler("GetQueueLength", "getQueueLength.ts");
    table.grantReadData(getQueueLength);

    const getDownloadUrl = handler("GetDownloadUrl", "getDownloadUrl.ts");
    table.grantReadData(getDownloadUrl);
    bucket.grantRead(getDownloadUrl);

    const completeJob = handler("CompleteJob", "completeJob.ts");
    table.grantWriteData(completeJob);

    const deleteJob = handler("DeleteJob", "deleteJob.ts");
    table.grantReadWriteData(deleteJob);
    bucket.grantDelete(deleteJob);

    // Every route requires an Entra access token issued by the UK tenant for
    // this app. Handlers then check scope, guest status and the Staff role
    // (backend/src/lib/auth.ts). CORS preflight requests skip the authorizer.
    const authorizer = new HttpJwtAuthorizer(
      "EntraAuthorizer",
      `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0`,
      { jwtAudience: [ENTRA_CLIENT_ID] },
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
        allowHeaders: ["authorization", "content-type"],
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

    // Goes in web/.env.local as VITE_API_URL.
    new cdk.CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
  }
}
