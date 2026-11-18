// One-off cleanup: removes studentEmail and studentId from job records created
// before the app stopped storing them. Jobs, names and files are untouched.
// Usage: npm run strip-student-ids -- --stage <dev|prod> --profile <aws-profile> [--yes]
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import {
  CloudFormationClient,
  DescribeStackResourcesCommand,
} from "@aws-sdk/client-cloudformation";
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const { values: args } = parseArgs({
  options: {
    stage: { type: "string" },
    profile: { type: "string" },
    yes: { type: "boolean", default: false },
  },
});

if (args.stage !== "dev" && args.stage !== "prod") {
  console.error("Pass --stage dev or --stage prod.");
  process.exit(1);
}
const STACK_NAME = `LaserQueue-${args.stage}`;

const clientConfig = { profile: args.profile };
const cloudformation = new CloudFormationClient(clientConfig);
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig));

async function findTable() {
  const { StackResources = [] } = await cloudformation.send(
    new DescribeStackResourcesCommand({ StackName: STACK_NAME }),
  );
  const id = StackResources.find(
    (r) => r.ResourceType === "AWS::DynamoDB::Table",
  )?.PhysicalResourceId;
  if (!id) throw new Error(`No table found in stack ${STACK_NAME}.`);
  return id;
}

async function listAffectedJobIds(table: string) {
  const ids: string[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: table,
        ProjectionExpression: "jobId",
        FilterExpression:
          "attribute_exists(studentEmail) OR attribute_exists(studentId)",
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) ids.push(item.jobId as string);
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return ids;
}

async function confirm() {
  if (args.yes) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Type "${args.stage}" to continue: `);
  rl.close();
  return answer.trim() === args.stage;
}

const table = await findTable();
const ids = await listAffectedJobIds(table);

console.log(`Stack: ${STACK_NAME}`);
console.log(`Table: ${table} (${ids.length} job(s) with an email or ID stored)`);

if (ids.length === 0) {
  console.log("Nothing to clean up.");
} else if (await confirm()) {
  let updated = 0;
  for (const jobId of ids) {
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: table,
          Key: { jobId },
          UpdateExpression: "REMOVE studentEmail, studentId",
          // Skip jobs deleted since the scan instead of recreating them.
          ConditionExpression: "attribute_exists(jobId)",
        }),
      );
      updated++;
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
    }
  }
  console.log(`Removed the email and ID from ${updated} job(s).`);
} else {
  console.log("Cancelled. Nothing was changed.");
}
