import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// Created once per Lambda container and reused across invocations.
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
export const s3 = new S3Client({});
