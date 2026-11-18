import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { authorize } from "../lib/auth.js";
import { ddb } from "../lib/aws.js";
import { config } from "../lib/config.js";
import { error } from "../lib/http.js";
import { archiveJob } from "../lib/jobs.js";
import type { JobRecord } from "../types.js";

// DELETE /jobs/{jobId} (staff only)
// Deletes the file and the student's details, but keeps the job's timestamps
// as an ArchivedJob so analytics can still count it.
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const auth = authorize(event, { staffOnly: true });
  if (!auth.ok) return auth.response;

  const jobId = event.pathParameters?.jobId;
  if (!jobId) return error(400, "Job ID is required.");

  const { Item } = await ddb.send(
    new GetCommand({ TableName: config.tableName, Key: { jobId } }),
  );
  const job = Item as JobRecord | undefined;
  if (!job || job.status === "ARCHIVED") return error(404, "Job not found.");

  if (job.status !== "COMPLETED") {
    return error(409, "Only completed jobs can be deleted.");
  }

  // If another request archived it first, the end result is the same.
  await archiveJob(job);

  return { statusCode: 204 };
};
