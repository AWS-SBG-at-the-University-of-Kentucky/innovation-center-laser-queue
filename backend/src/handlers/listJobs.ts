import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { error } from "../lib/http.js";

// GET /jobs
// TODO (Milestone 3): return { jobs } sorted oldest submission first.
export const handler: APIGatewayProxyHandlerV2 = async () => {
  return error(501, "GET /jobs is not implemented yet");
};
