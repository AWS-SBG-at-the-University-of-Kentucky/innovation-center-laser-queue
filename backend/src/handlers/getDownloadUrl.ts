import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { error } from "../lib/http.js";

// GET /jobs/{jobId}/download
// TODO (Milestone 3): look up the Job and return { downloadUrl }, a presigned
// S3 GET URL for its s3Key.
export const handler: APIGatewayProxyHandlerV2 = async () => {
  return error(501, "GET /jobs/{jobId}/download is not implemented yet");
};
