import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ddb, s3 } from "../lib/aws.js";
import { config } from "../lib/config.js";
import { error, json } from "../lib/http.js";
import { validateCreateJob } from "../lib/validation.js";
import type { Job } from "../types.js";

// POST /jobs
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
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
    studentName: input.studentName,
    studentEmail: input.studentEmail,
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
