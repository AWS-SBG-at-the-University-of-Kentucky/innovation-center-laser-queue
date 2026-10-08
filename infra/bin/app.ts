import * as cdk from "aws-cdk-lib";
import { LaserQueueStack } from "../lib/laser-queue-stack.js";

const app = new cdk.App();

// Override with `cdk deploy -c stage=prod`.
const stage: string = app.node.tryGetContext("stage") ?? "dev";
if (stage !== "dev" && stage !== "prod") {
  throw new Error("stage must be dev or prod");
}

new LaserQueueStack(app, `LaserQueue-${stage}`, {
  terminationProtection: stage === "prod",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
