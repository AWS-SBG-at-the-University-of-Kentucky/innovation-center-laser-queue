import { randomUUID } from "node:crypto";
import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { authorize } from "../lib/auth.js";
import { ddb } from "../lib/aws.js";
import { config } from "../lib/config.js";
import { error, json } from "../lib/http.js";
import {
  MAX_STATION_NAME_LENGTH,
  MAX_STATIONS,
  parsePublicKey,
  parseStationName,
  toStationSummary,
} from "../lib/stations.js";
import type { Station } from "../types.js";

// POST /stations (staff only, signed in: a station can't register another)
// Registers the PC the request came from. The browser made a key pair whose
// private half can't be exported; only the public key is sent here.
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (
  event,
) => {
  const auth = authorize(event, { staffOnly: true });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "");
  } catch {
    return error(400, "Request body must be valid JSON.");
  }
  const fields =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const name = parseStationName(fields.name);
  if (!name) {
    return error(
      400,
      `Give the station a name of up to ${MAX_STATION_NAME_LENGTH} characters.`,
    );
  }
  const publicKey = parsePublicKey(fields.publicKey);
  if (!publicKey) return error(400, "The station's public key is not valid.");

  const { Count = 0 } = await ddb.send(
    new ScanCommand({ TableName: config.stationsTableName, Select: "COUNT" }),
  );
  if (Count >= MAX_STATIONS) {
    return error(
      409,
      `There are already ${MAX_STATIONS} stations. Remove one you no longer use first.`,
    );
  }

  const station: Station = {
    stationId: randomUUID(),
    name,
    publicKey,
    createdAt: new Date().toISOString(),
    createdBy: auth.user.name,
  };
  await ddb.send(
    new PutCommand({
      TableName: config.stationsTableName,
      Item: station,
      ConditionExpression: "attribute_not_exists(stationId)",
    }),
  );
  console.log(`Station ${station.stationId} registered by ${auth.user.id}`);

  return json(201, { station: toStationSummary(station) });
};
