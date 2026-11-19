import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Job, JobSummary } from "../types.js";
import { ddb, s3 } from "./aws.js";
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

/**
 * Deletes a job's file and strips the student's name and file name, leaving
 * an ArchivedJob with only its timestamps for analytics. Used when staff
 * delete a job and by the weekly cleanup.
 *
 * Only archives the job if its status is still `job.status`. Returns false if
 * it had changed (for example, another request already archived it).
 */
export async function archiveJob(job: Job): Promise<boolean> {
  // File first: if this fails the record still points at the file, so it can
  // be retried instead of leaving an orphaned file behind.
  await s3.send(
    new DeleteObjectCommand({ Bucket: config.bucketName, Key: job.s3Key }),
  );

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: config.tableName,
        Key: { jobId: job.jobId },
        // Also removes studentEmail/studentId left on old records.
        UpdateExpression:
          "SET #status = :archived, archivedAt = :now " +
          "REMOVE studentName, originalFileName, s3Key, fileExtension, studentEmail, studentId",
        ConditionExpression: "#status = :expected",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":archived": "ARCHIVED",
          ":expected": job.status,
          ":now": new Date().toISOString(),
        },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}
