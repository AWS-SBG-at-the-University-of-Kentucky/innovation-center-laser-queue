import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyEventV2WithLambdaAuthorizer,
  APIGatewayProxyResultV2,
  APIGatewayProxyStructuredResultV2,
  Handler,
} from "aws-lambda";
import type { StationContext } from "../authorizers/station.js";
import { error } from "./http.js";

// API Gateway's JWT authorizer has already checked the token's signature,
// expiry, issuer (our Entra tenant) and audience (our app registration) before
// a handler runs. This file checks the claims that decide what the caller may
// do. See "Authentication" in docs/architecture.md.
//
// The /station/* routes use the station authorizer (authorizers/station.ts)
// instead, which has already checked the lab station's signature. Those
// requests carry the station's ID rather than token claims, and are only
// accepted by handlers that pass `allowStation`. See "Lab stations".

/** The delegated scope the frontend requests; see "Expose an API" in Entra. */
const API_SCOPE = "access_as_user";
/** App role assigned to lab staff in Entra (Enterprise applications). */
const STAFF_ROLE = "Staff";

/** A request from a signed-in user, or from a lab station. */
export type ApiEvent =
  | APIGatewayProxyEventV2WithJWTAuthorizer
  | APIGatewayProxyEventV2WithLambdaAuthorizer<StationContext>;

/** A handler that also serves a /station/* route. */
export type ApiHandler = Handler<ApiEvent, APIGatewayProxyResultV2>;

type Claims =
  APIGatewayProxyEventV2WithJWTAuthorizer["requestContext"]["authorizer"]["jwt"]["claims"];

export interface User {
  /** Entra object ID; stable even if the user's name or email changes. */
  id: string;
  /** Display name. The only part of the user that gets stored with a job. */
  name: string;
  /** Linkblue sign-in (abc123@uky.edu). Checked, never stored. */
  email: string;
  isStaff: boolean;
}

/** A registered lab PC, using the queue without anyone signed in. */
export interface LabStation {
  stationId: string;
  name: string;
}

type Denied = { ok: false; response: APIGatewayProxyStructuredResultV2 };

export type AuthResult = { ok: true; user: User } | Denied;

/** For staff routes that lab stations may also call. */
export type StaffOrStationResult =
  | { ok: true; user: User; station?: undefined }
  | { ok: true; user?: undefined; station: LabStation }
  | Denied;

function stringClaim(claims: Claims, name: string): string | undefined {
  const value = claims[name];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

/**
 * Multi-valued claims (roles) arrive as an array or, from HTTP API JWT
 * authorizers, flattened into a string like "[Staff Other]".
 */
function listClaim(claims: Claims, name: string): string[] {
  const value = claims[name];
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  return value
    .replace(/^\[|\]$/g, "")
    .split(/[\s,]+/)
    .filter(Boolean);
}

function deny(statusCode: number, message: string, reason: string): Denied {
  console.warn(`Auth denied (${statusCode}): ${reason}`);
  return { ok: false, response: error(statusCode, message) };
}

/**
 * Identifies the caller and checks they may use this route. Every handler
 * calls this first and returns `response` when `ok` is false.
 *
 * Lab stations are rejected unless `allowStation` is set, which only staff
 * routes may do: a station stands in for staff at the lab PC.
 */
export function authorize(
  event: ApiEvent,
  options: { staffOnly: boolean; allowStation?: false },
): AuthResult;
export function authorize(
  event: ApiEvent,
  options: { staffOnly: true; allowStation: true },
): StaffOrStationResult;
export function authorize(
  event: ApiEvent,
  {
    staffOnly,
    allowStation = false,
  }: { staffOnly: boolean; allowStation?: boolean },
): StaffOrStationResult {
  const authorizer = event.requestContext.authorizer;
  if (authorizer && "lambda" in authorizer) {
    if (!allowStation) {
      return deny(
        403,
        "Sign in with your UK account to do this.",
        "station on a route that doesn't allow stations",
      );
    }
    const { stationId, stationName } = authorizer.lambda ?? {};
    if (!stationId) {
      return deny(
        401,
        "This PC isn't a registered lab station.",
        "no station ID",
      );
    }
    return { ok: true, station: { stationId, name: stationName ?? "" } };
  }

  const claims =
    authorizer && "jwt" in authorizer ? authorizer.jwt?.claims : undefined;
  if (!claims) {
    return deny(401, "Sign in to continue.", "no JWT claims on request");
  }

  // Rejects tokens issued to apps without a user, and tokens for other scopes.
  if (!listClaim(claims, "scp").includes(API_SCOPE)) {
    return deny(403, "Sign in to continue.", `missing ${API_SCOPE} scope`);
  }

  // acct is 0 for members of the tenant and 1 for invited guests. Fails closed
  // if the optional claim stops being emitted (Entra > Token configuration).
  if (stringClaim(claims, "acct") !== "0") {
    return deny(
      403,
      "Only University of Kentucky accounts can use this site.",
      `acct claim is ${JSON.stringify(claims.acct)}`,
    );
  }

  const id = stringClaim(claims, "oid");
  // preferred_username is the linkblue sign-in name (abc123@uky.edu), which
  // is what staff know students by and what the frontend shows. The optional
  // email claim (often first.last@uky.edu) is only a fallback.
  const email = (
    stringClaim(claims, "preferred_username") ?? stringClaim(claims, "email")
  )?.toLowerCase();
  if (!id || !email) {
    return deny(403, "Your account is missing an email address.", "no oid/email");
  }

  const isStaff = listClaim(claims, "roles").includes(STAFF_ROLE);
  if (staffOnly && !isStaff) {
    return deny(403, "Only Innovation Center staff can do this.", "not staff");
  }

  // The name is stored with the job, so its fallback is the linkblue ID
  // (abc123), never the full email address.
  const name =
    stringClaim(claims, "name") ?? (email.split("@")[0] || "UK student");

  return { ok: true, user: { id, email, isStaff, name } };
}
