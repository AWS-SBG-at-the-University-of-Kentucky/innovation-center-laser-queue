import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ddb } from "../lib/aws.js";
import { config } from "../lib/config.js";
import { json } from "../lib/http.js";
import type { Job, JobSummary } from "../types.js";

// GET /jobs
export const handler: APIGatewayProxyHandlerV2 = async () => {
  const items: Job[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: config.tableName,
        FilterExpression: "#status = :queued",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":queued": "QUEUED" },
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...((page.Items ?? []) as Job[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  const jobs: JobSummary[] = items
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(({ s3Key: _s3Key, ...summary }) => summary);

  return json(200, { jobs });
};
