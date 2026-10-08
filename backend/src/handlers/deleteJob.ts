import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ddb, s3 } from "../lib/aws.js";
import { config } from "../lib/config.js";
import { error } from "../lib/http.js";
import type { Job } from "../types.js";

// DELETE /jobs/{jobId}
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const jobId = event.pathParameters?.jobId;
  if (!jobId) return error(400, "Job ID is required.");

  const { Item } = await ddb.send(
    new GetCommand({ TableName: config.tableName, Key: { jobId } }),
  );
  if (!Item) return error(404, "Job not found.");
  const job = Item as Job;

  if (job.status !== "COMPLETED") {
    return error(409, "Only completed jobs can be deleted.");
  }

  // File first: if this fails the record is still there, so the delete can be
  // retried instead of leaving an orphaned file behind.
  await s3.send(
    new DeleteObjectCommand({ Bucket: config.bucketName, Key: job.s3Key }),
  );
  await ddb.send(
    new DeleteCommand({ TableName: config.tableName, Key: { jobId } }),
  );

  return { statusCode: 204 };
};
