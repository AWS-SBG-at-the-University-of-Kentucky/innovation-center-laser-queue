import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerResult,
  APIGatewaySimpleAuthorizerWithContextResult,
} from "aws-lambda";
import { ddb } from "../lib/aws.js";
import { config } from "../lib/config.js";
import {
  MAX_CLOCK_SKEW_MS,
  STATION_HEADERS,
  isStationId,
  signedMessage,
  verifySignature,
} from "../lib/stations.js";
import type { Station } from "../types.js";

/** Passed to the route's handler as requestContext.authorizer.lambda. */
export interface StationContext {
  stationId: string;
  stationName: string;
}

/** lastUsedAt is only rewritten when it's older than this (or the IP changed). */
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000;

const DENY: APIGatewaySimpleAuthorizerResult = { isAuthorized: false };

function deny(reason: string): APIGatewaySimpleAuthorizerResult {
  console.warn(`Station denied: ${reason}`);
  return DENY;
}

// Lambda authorizer for the /station/* routes, which the lab PC calls without
// a Microsoft sign-in. Checks the request was signed by a registered station's
// private key within the last few minutes. Results aren't cached (every
// signature is different), so revoking a station takes effect immediately.
// The handler then calls authorize() with allowStation (lib/auth.ts).
export async function handler(
  event: APIGatewayRequestAuthorizerEventV2,
): Promise<
  | APIGatewaySimpleAuthorizerResult
  | APIGatewaySimpleAuthorizerWithContextResult<StationContext>
> {
  const headers = event.headers ?? {};
  const stationId = headers[STATION_HEADERS.id];
  const time = headers[STATION_HEADERS.time];
  const signature = headers[STATION_HEADERS.signature];

  if (!isStationId(stationId)) return deny("malformed station ID");
  if (!time || !/^\d{1,16}$/.test(time)) return deny("malformed timestamp");
  if (!signature || signature.length > 200) return deny("malformed signature");

  const now = Date.now();
  if (Math.abs(now - Number(time)) > MAX_CLOCK_SKEW_MS) {
    return deny(`timestamp off by ${Math.round((now - Number(time)) / 1000)}s`);
  }

  const { Item } = await ddb.send(
    new GetCommand({
      TableName: config.stationsTableName,
      Key: { stationId },
    }),
  );
  const station = Item as Station | undefined;
  if (!station) return deny(`unknown station ${stationId}`);

  const message = signedMessage({
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: event.rawQueryString,
    time,
    stationId,
  });
  if (!verifySignature(station.publicKey, message, signature)) {
    return deny(`bad signature for station ${stationId}`);
  }

  const ip = event.requestContext.http.sourceIp;
  const lastUsed = station.lastUsedAt ? Date.parse(station.lastUsedAt) : 0;
  if (now - lastUsed > LAST_USED_RESOLUTION_MS || station.lastUsedIp !== ip) {
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: config.stationsTableName,
          Key: { stationId },
          UpdateExpression: "SET lastUsedAt = :now, lastUsedIp = :ip",
          // Don't recreate a station that was removed a moment ago.
          ConditionExpression: "attribute_exists(stationId)",
          ExpressionAttributeValues: {
            ":now": new Date(now).toISOString(),
            ":ip": ip,
          },
        }),
      );
    } catch (err) {
      // Only bookkeeping: don't block the lab over it.
      console.warn("Couldn't record station use", err);
    }
  }

  return {
    isAuthorized: true,
    context: { stationId, stationName: station.name },
  };
}
