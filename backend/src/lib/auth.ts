import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { error } from "./http.js";

// API Gateway's JWT authorizer has already checked the token's signature,
// expiry, issuer (our Entra tenant) and audience (our app registration) before
// a handler runs. This file checks the claims that decide what the caller may
// do. See "Authentication" in docs/architecture.md.

/** The delegated scope the frontend requests; see "Expose an API" in Entra. */
const API_SCOPE = "access_as_user";
/** App role assigned to lab staff in Entra (Enterprise applications). */
const STAFF_ROLE = "Staff";

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

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; response: APIGatewayProxyStructuredResultV2 };

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

function deny(statusCode: number, message: string, reason: string): AuthResult {
  console.warn(`Auth denied (${statusCode}): ${reason}`);
  return { ok: false, response: error(statusCode, message) };
}

/**
 * Identifies the caller and checks they may use this route. Every handler
 * calls this first and returns `response` when `ok` is false.
 */
export function authorize(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  { staffOnly }: { staffOnly: boolean },
): AuthResult {
  const claims = event.requestContext.authorizer?.jwt?.claims;
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
