import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { type ApiHandler, authorize } from "../lib/auth.js";
import { ddb } from "../lib/aws.js";
import { config } from "../lib/config.js";
import { json } from "../lib/http.js";
import { toSummary } from "../lib/jobs.js";
import type { Job, JobSummary } from "../types.js";

// GET /jobs (staff only)
// GET /station/jobs (lab stations)
export const handler: ApiHandler = async (event) => {
  const auth = authorize(event, { staffOnly: true, allowStation: true });
  if (!auth.ok) return auth.response;

  const items: Job[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: config.tableName,
        // Deleted jobs stay in the table for analytics; the queue skips them.
        FilterExpression: "#status <> :archived",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":archived": "ARCHIVED" },
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...((page.Items ?? []) as Job[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  const jobs: JobSummary[] = items
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toSummary);

  return json(200, { jobs });
};
