import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
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

// TODO: restrict to the Amplify app URL once the frontend is deployed.
const ALLOWED_ORIGINS = ["*"];

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
    table.grantWriteData(createJob);
    bucket.grantPut(createJob);

    const listJobs = handler("ListJobs", "listJobs.ts");
    table.grantReadData(listJobs);

    const getDownloadUrl = handler("GetDownloadUrl", "getDownloadUrl.ts");
    table.grantReadData(getDownloadUrl);
    bucket.grantRead(getDownloadUrl);

    const completeJob = handler("CompleteJob", "completeJob.ts");
    table.grantWriteData(completeJob);

    const deleteJob = handler("DeleteJob", "deleteJob.ts");
    table.grantReadWriteData(deleteJob);
    bucket.grantDelete(deleteJob);

    const api = new apigwv2.HttpApi(this, "Api", {
      corsPreflight: {
        allowOrigins: ALLOWED_ORIGINS,
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["content-type"],
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
