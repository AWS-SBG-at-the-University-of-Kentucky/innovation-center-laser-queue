import * as cdk from "aws-cdk-lib";
import { LaserQueueStack } from "../lib/laser-queue-stack.js";

const app = new cdk.App();

// Override with `cdk deploy -c stage=prod`.
const stage: string = app.node.tryGetContext("stage") ?? "dev";

new LaserQueueStack(app, `LaserQueue-${stage}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
