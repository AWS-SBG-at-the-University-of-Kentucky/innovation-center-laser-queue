import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ddb } from "../lib/aws.js";
import { config } from "../lib/config.js";
import { error, json } from "../lib/http.js";
import type { Job, JobSummary } from "../types.js";

// POST /jobs/{jobId}/complete
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
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
        // Without this, updating an unknown ID would create a new item.
        ConditionExpression: "attribute_exists(jobId)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":completed": "COMPLETED",
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

  const { s3Key: _s3Key, ...summary } = job;
  return json(200, { job: summary satisfies JobSummary });
};
