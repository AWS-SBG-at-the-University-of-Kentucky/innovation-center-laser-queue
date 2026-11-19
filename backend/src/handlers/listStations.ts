import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { authorize } from "../lib/auth.js";
import { ddb } from "../lib/aws.js";
import { config } from "../lib/config.js";
import { json } from "../lib/http.js";
import { toStationSummary } from "../lib/stations.js";
import type { Station } from "../types.js";

// GET /stations (staff only, signed in: a station can't list stations)
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (
  event,
) => {
  const auth = authorize(event, { staffOnly: true });
  if (!auth.ok) return auth.response;

  const items: Station[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: config.stationsTableName,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...((page.Items ?? []) as Station[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  const stations = items
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toStationSummary);

  return json(200, { stations });
};
