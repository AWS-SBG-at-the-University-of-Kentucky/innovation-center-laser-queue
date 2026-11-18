import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { summarize } from "../lib/analytics.js";
import { authorize } from "../lib/auth.js";
import { ddb } from "../lib/aws.js";
import { config } from "../lib/config.js";
import { json } from "../lib/http.js";
import type { JobRecord } from "../types.js";

type Timestamps = Pick<JobRecord, "status" | "createdAt" | "completedAt">;

// GET /analytics (staff only)
// Usage counts for the analytics page. Includes deleted (archived) jobs, and
// reads only timestamps: no names or file names.
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const auth = authorize(event, { staffOnly: true });
  if (!auth.ok) return auth.response;

  const records: Timestamps[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: config.tableName,
        ProjectionExpression: "#status, createdAt, completedAt",
        ExpressionAttributeNames: { "#status": "status" },
        ExclusiveStartKey: startKey,
      }),
    );
    records.push(...((page.Items ?? []) as Timestamps[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  return json(200, summarize(records));
};
