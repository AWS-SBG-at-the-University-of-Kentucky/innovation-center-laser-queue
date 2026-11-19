import { createPublicKey, verify } from "node:crypto";
import type { Station, StationPublicKey, StationSummary } from "../types.js";

// Lab stations sign every request with a key that only exists on that PC. See
// "Lab stations" in docs/architecture.md. The signing side is web/src/station.ts.

/** Request headers a station sends. Mirrored in web/src/station.ts. */
export const STATION_HEADERS = {
  id: "x-station-id",
  time: "x-station-time",
  signature: "x-station-signature",
} as const;

/** How far a request's timestamp may be from the server's clock. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Registering more than this many stations is refused. */
export const MAX_STATIONS = 20;

export const MAX_STATION_NAME_LENGTH = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A P-256 coordinate: 32 bytes, base64url without padding. */
const COORDINATE = /^[A-Za-z0-9_-]{43}$/;

export function isStationId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * The exact text a station signs for a request. Mirrored in
 * web/src/station.ts; the two must produce the same string.
 */
export function signedMessage(parts: {
  method: string;
  path: string;
  query: string;
  time: string;
  stationId: string;
}): string {
  return [
    "laser-queue-station-v1",
    parts.method.toUpperCase(),
    parts.path,
    parts.query,
    parts.time,
    parts.stationId,
  ].join("\n");
}

/** Checks an ECDSA P-256 / SHA-256 signature in WebCrypto's raw (r||s) form. */
export function verifySignature(
  publicKey: StationPublicKey,
  message: string,
  signature: string,
): boolean {
  try {
    return verify(
      "sha256",
      Buffer.from(message),
      {
        key: createPublicKey({ key: { ...publicKey }, format: "jwk" }),
        dsaEncoding: "ieee-p1363",
      },
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

/**
 * Validates a public key from a registration request, keeping only the fields
 * we need. Returns undefined if it isn't a usable P-256 public key.
 */
export function parsePublicKey(value: unknown): StationPublicKey | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { kty, crv, x, y, d } = value as Record<string, unknown>;
  // A private key ("d") means the browser didn't keep it to itself.
  if (d !== undefined) return undefined;
  if (kty !== "EC" || crv !== "P-256") return undefined;
  if (typeof x !== "string" || !COORDINATE.test(x)) return undefined;
  if (typeof y !== "string" || !COORDINATE.test(y)) return undefined;
  const key: StationPublicKey = { kty, crv, x, y };
  try {
    // Throws if the point isn't on the curve.
    createPublicKey({ key: { ...key }, format: "jwk" });
  } catch {
    return undefined;
  }
  return key;
}

/** Trims a station name; undefined if it's empty, too long or has control characters. */
export function parseStationName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_STATION_NAME_LENGTH) return undefined;
  if (/\p{Cc}/u.test(name)) return undefined;
  return name;
}

/** Fields copied one by one so the public key never leaves the backend. */
export function toStationSummary(station: Station): StationSummary {
  return {
    stationId: station.stationId,
    name: station.name,
    createdAt: station.createdAt,
    createdBy: station.createdBy,
    ...(station.lastUsedAt ? { lastUsedAt: station.lastUsedAt } : {}),
    ...(station.lastUsedIp ? { lastUsedIp: station.lastUsedIp } : {}),
  };
}
