import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { authorize } from "../lib/auth.js";
import { ddb, s3 } from "../lib/aws.js";
import { config } from "../lib/config.js";
import { error, json } from "../lib/http.js";
import { validateCreateJob } from "../lib/validation.js";
import type { Job } from "../types.js";

// POST /jobs (any signed-in UK member)
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const auth = authorize(event, { staffOnly: false });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return error(400, "Request body must be valid JSON.");
  }

  const result = validateCreateJob(body, config.maxFileSizeBytes);
  if (!result.ok) return error(400, result.message);
  const input = result.value;

  const jobId = randomUUID();
  const job: Job = {
    jobId,
    studentId: auth.user.id,
    studentName: auth.user.name,
    studentEmail: auth.user.email,
    originalFileName: input.fileName,
    s3Key: `jobs/${jobId}/${input.fileName}`,
    fileExtension: input.fileExtension,
    status: "QUEUED",
    createdAt: new Date().toISOString(),
  };

  // Signing the content length means S3 rejects an upload of any other size,
  // which is what enforces the file-size limit checked above.
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: job.s3Key,
      ContentLength: input.fileSize,
    }),
    {
      expiresIn: config.urlExpirySeconds,
      signableHeaders: new Set(["content-length"]),
    },
  );

  await ddb.send(new PutCommand({ TableName: config.tableName, Item: job }));

  return json(201, { jobId, uploadUrl });
};
