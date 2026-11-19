import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { authorize } from "../lib/auth.js";
import { ddb } from "../lib/aws.js";
import { config } from "../lib/config.js";
import { error } from "../lib/http.js";
import { isStationId } from "../lib/stations.js";

// DELETE /stations/{stationId} (staff only, signed in)
// Takes effect on the station's next request: the station authorizer doesn't
// cache its results.
export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (
  event,
) => {
  const auth = authorize(event, { staffOnly: true });
  if (!auth.ok) return auth.response;

  const stationId = event.pathParameters?.stationId;
  if (!isStationId(stationId)) return error(404, "Station not found.");

  try {
    await ddb.send(
      new DeleteCommand({
        TableName: config.stationsTableName,
        Key: { stationId },
        ConditionExpression: "attribute_exists(stationId)",
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return error(404, "Station not found.");
    }
    throw err;
  }
  console.log(`Station ${stationId} removed by ${auth.user.id}`);

  return { statusCode: 204 };
};
