import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { config } from "../lib/config.js";
import { ddb } from "../lib/aws.js";
import { archiveJob } from "../lib/jobs.js";
import type { Job } from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Jobs archived at once; each is one S3 call and one DynamoDB call. */
const CONCURRENCY = 10;

/**
 * Weekly cleanup, run by EventBridge Scheduler (see WeeklyCleanup in
 * infra/lib/laser-queue-stack.ts). It isn't an API route, so there is no
 * caller to authorize(): only the scheduler can invoke it.
 *
 * Archives, exactly as if staff had deleted them:
 * - every completed job staff didn't delete, and
 * - every queued job older than QUEUED_JOB_MAX_AGE_DAYS, which is treated as
 *   abandoned (the student left, or the upload never finished). These keep no
 *   completedAt, so analytics counts them as expired rather than cut.
 *
 * Safe to run again: archived jobs are skipped.
 */
export const handler = async () => {
  const cutoff = new Date(
    Date.now() - config.queuedJobMaxAgeDays * DAY_MS,
  ).toISOString();

  const jobs: Job[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: config.tableName,
        FilterExpression:
          "#status = :completed OR (#status = :queued AND createdAt < :cutoff)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":completed": "COMPLETED",
          ":queued": "QUEUED",
          ":cutoff": cutoff,
        },
        ExclusiveStartKey: startKey,
      }),
    );
    jobs.push(...((page.Items ?? []) as Job[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  const result = { completed: 0, expired: 0, skipped: 0, failed: 0 };
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    await Promise.all(
      jobs.slice(i, i + CONCURRENCY).map(async (job) => {
        try {
          if (!(await archiveJob(job))) result.skipped++;
          else if (job.status === "COMPLETED") result.completed++;
          else result.expired++;
        } catch (err) {
          result.failed++;
          console.error(`Failed to archive job ${job.jobId}`, err);
        }
      }),
    );
  }

  console.log("Weekly cleanup", JSON.stringify(result));
  // Failing the run makes the scheduler retry it, which only picks up the
  // jobs that are still left.
  if (result.failed > 0) {
    throw new Error(`Failed to archive ${result.failed} job(s).`);
  }
  return result;
};
