// Deletes every uploaded file and job record in the dev stack.
// Usage: npm run reset:dev -- --profile <aws-profile> [--yes]
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import {
  CloudFormationClient,
  DescribeStackResourcesCommand,
} from "@aws-sdk/client-cloudformation";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

// Deliberately not configurable: this script can only ever target dev.
const STACK_NAME = "LaserQueue-dev";

const { values: args } = parseArgs({
  options: {
    profile: { type: "string" },
    yes: { type: "boolean", default: false },
  },
});

const clientConfig = { profile: args.profile };
const cloudformation = new CloudFormationClient(clientConfig);
const s3 = new S3Client(clientConfig);
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig));

async function findResources() {
  const { StackResources = [] } = await cloudformation.send(
    new DescribeStackResourcesCommand({ StackName: STACK_NAME }),
  );
  const physicalId = (type: string) => {
    const id = StackResources.find((r) => r.ResourceType === type)
      ?.PhysicalResourceId;
    if (!id) throw new Error(`No ${type} found in stack ${STACK_NAME}.`);
    // Second check on top of the fixed stack name: CDK prefixes generated
    // names with the stack name, so anything else is not a dev resource.
    if (!id.toLowerCase().startsWith(`${STACK_NAME.toLowerCase()}-`)) {
      throw new Error(`Refusing to touch ${id}: not a ${STACK_NAME} resource.`);
    }
    return id;
  };
  return {
    bucket: physicalId("AWS::S3::Bucket"),
    table: physicalId("AWS::DynamoDB::Table"),
  };
}

async function listFileKeys(bucket: string) {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    token = page.NextContinuationToken;
  } while (token);
  return keys;
}

async function listJobIds(table: string) {
  const ids: string[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: table,
        ProjectionExpression: "jobId",
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) ids.push(item.jobId as string);
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return ids;
}

async function deleteFiles(bucket: string, keys: string[]) {
  // DeleteObjects accepts at most 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) {
    const result = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
    if (result.Errors?.length) {
      throw new Error(`Failed to delete ${result.Errors.length} file(s).`);
    }
  }
}

async function deleteJobs(table: string, ids: string[]) {
  // BatchWrite accepts at most 25 requests per call.
  for (let i = 0; i < ids.length; i += 25) {
    let requests = ids
      .slice(i, i + 25)
      .map((jobId) => ({ DeleteRequest: { Key: { jobId } } }));
    while (requests.length > 0) {
      const result = await ddb.send(
        new BatchWriteCommand({ RequestItems: { [table]: requests } }),
      );
      requests = (result.UnprocessedItems?.[table] ?? []) as typeof requests;
    }
  }
}

async function confirm() {
  if (args.yes) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "dev" to delete them: ');
  rl.close();
  return answer.trim() === "dev";
}

const { bucket, table } = await findResources();
const [keys, ids] = await Promise.all([listFileKeys(bucket), listJobIds(table)]);

console.log(`Stack:  ${STACK_NAME}`);
console.log(`Bucket: ${bucket} (${keys.length} file(s))`);
console.log(`Table:  ${table} (${ids.length} job(s))`);

if (keys.length === 0 && ids.length === 0) {
  console.log("Already empty.");
} else if (await confirm()) {
  await deleteFiles(bucket, keys);
  await deleteJobs(table, ids);
  console.log(`Deleted ${keys.length} file(s) and ${ids.length} job(s).`);
} else {
  console.log("Cancelled. Nothing was deleted.");
}
