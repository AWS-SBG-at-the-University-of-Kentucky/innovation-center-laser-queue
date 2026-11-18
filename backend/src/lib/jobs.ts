import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { Job, JobSummary } from "../types.js";
import { ddb } from "./aws.js";
import { config } from "./config.js";

/**
 * What the API returns for a job. Fields are copied one by one, not spread, so
 * nothing else on a record leaves the backend: not `s3Key`, and not the
 * `studentEmail`/`studentId` that records from before they were dropped still
 * carry.
 */
export function toSummary(job: Job): JobSummary {
  return {
    jobId: job.jobId,
    studentName: job.studentName,
    originalFileName: job.originalFileName,
    fileExtension: job.fileExtension,
    status: job.status,
    createdAt: job.createdAt,
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
  };
}

/**
 * Counts jobs waiting to be cut, optionally only those submitted at or before
 * `upTo` (a createdAt timestamp). Scans the whole table, like GET /jobs.
 */
export async function countQueued(upTo?: string): Promise<number> {
  let count = 0;
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: config.tableName,
        Select: "COUNT",
        FilterExpression: upTo
          ? "#status = :queued AND createdAt <= :upTo"
          : "#status = :queued",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":queued": "QUEUED",
          ...(upTo ? { ":upTo": upTo } : {}),
        },
        ExclusiveStartKey: startKey,
      }),
    );
    count += page.Count ?? 0;
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return count;
}
