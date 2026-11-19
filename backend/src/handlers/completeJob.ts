import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { authorize } from "../lib/auth.js";
import { ddb } from "../lib/aws.js";
import { config } from "../lib/config.js";
import { error, json } from "../lib/http.js";
import { toSummary } from "../lib/jobs.js";
import type { Job } from "../types.js";

// POST /jobs/{jobId}/complete (staff only)
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const auth = authorize(event, { staffOnly: true });
  if (!auth.ok) return auth.response;

  const jobId = event.pathParameters?.jobId;
  if (!jobId) return error(400, "Job ID is required.");

  let job: Job;
  try {
    const { Attributes } = await ddb.send(
      new UpdateCommand({
        TableName: config.tableName,
        Key: { jobId },
        // if_not_exists keeps the original time if the job is completed twice.
        UpdateExpression:
          "SET #status = :completed, completedAt = if_not_exists(completedAt, :now)",
        // Without the first check, updating an unknown ID would create a new
        // item. Deleted (archived) jobs can't be completed again.
        ConditionExpression: "attribute_exists(jobId) AND #status <> :archived",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":completed": "COMPLETED",
          ":archived": "ARCHIVED",
          ":now": new Date().toISOString(),
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    job = Attributes as Job;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return error(404, "Job not found.");
    }
    throw err;
  }

  return json(200, { job: toSummary(job) });
};
