import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { error } from "../lib/http.js";

// POST /jobs
// TODO (Milestone 2): validate name/email/extension, write the Job to DynamoDB,
// and return { jobId, uploadUrl } where uploadUrl is a presigned S3 PUT URL.
export const handler: APIGatewayProxyHandlerV2 = async () => {
  return error(501, "POST /jobs is not implemented yet");
};
