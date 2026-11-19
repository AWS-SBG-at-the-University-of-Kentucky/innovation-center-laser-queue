import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
} from "@aws-sdk/client-s3";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { authorize } from "../lib/auth.js";
import { ddb, s3 } from "../lib/aws.js";
import { config } from "../lib/config.js";
import { error, json } from "../lib/http.js";
import type { JobRecord } from "../types.js";

// GET /jobs/{jobId}/download (staff only)
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const auth = authorize(event, { staffOnly: true });
  if (!auth.ok) return auth.response;

  const jobId = event.pathParameters?.jobId;
  if (!jobId) return error(400, "Job ID is required.");

  const { Item } = await ddb.send(
    new GetCommand({ TableName: config.tableName, Key: { jobId } }),
  );
  const job = Item as JobRecord | undefined;
  // Deleted jobs keep an archived record, but no file.
  if (!job || job.status === "ARCHIVED") return error(404, "Job not found.");

  // The job record is written before the browser uploads, so the file can be
  // missing if that upload never finished.
  try {
    await s3.send(
      new HeadObjectCommand({ Bucket: config.bucketName, Key: job.s3Key }),
    );
  } catch (err) {
    if (err instanceof NotFound) {
      return error(404, "This job's file was never uploaded.");
    }
    throw err;
  }

  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: config.bucketName,
      Key: job.s3Key,
      ResponseContentDisposition: `attachment; filename="${job.originalFileName}"`,
    }),
    { expiresIn: config.urlExpirySeconds },
  );

  return json(200, { downloadUrl });
};
