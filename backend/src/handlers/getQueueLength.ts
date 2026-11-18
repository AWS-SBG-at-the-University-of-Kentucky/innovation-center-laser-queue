import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { authorize } from "../lib/auth.js";
import { json } from "../lib/http.js";
import { countQueued } from "../lib/jobs.js";

// GET /queue/length (any signed-in UK member)
// Only a count, so students can see how busy the laser is. The jobs themselves
// (names and file names) stay behind the staff-only GET /jobs.
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const auth = authorize(event, { staffOnly: false });
  if (!auth.ok) return auth.response;

  return json(200, { queued: await countQueued() });
};
