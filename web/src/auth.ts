import {
  type AccountInfo,
  InteractionRequiredAuthError,
  PublicClientApplication,
} from "@azure/msal-browser";
import { type LocalStation, loadStation } from "./station";

// The Entra ID app registration "Innovation Center Queue" in the University of
// Kentucky tenant. Neither value is a secret. Mirrored in
// infra/lib/laser-queue-stack.ts, which validates the tokens.
const TENANT_ID = "2b30530b-69b6-4457-b818-481cb53d42ae";
const CLIENT_ID = "eae4e6cc-becd-41cb-906c-e68c5ea58ff0";

/** The delegated scope the API checks for (backend/src/lib/auth.ts). */
const API_SCOPE = `api://${CLIENT_ID}/access_as_user`;
/** App role that unlocks the queue page; the API enforces it too. */
const STAFF_ROLE = "Staff";

const msal = new PublicClientApplication({
  auth: {
    clientId: CLIENT_ID,
    // Single-tenant: only UK accounts can sign in.
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    // Must exactly match a SPA redirect URI on the app registration. MSAL
    // returns the user to the page they started on afterwards.
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  // Tokens last only as long as the tab. The lab PC doesn't stay signed in:
  // it's a lab station instead (station.ts).
  cache: { cacheLocation: "sessionStorage" },
});

const loginRequest = { scopes: [API_SCOPE] };

let ready: Promise<AccountInfo | null> | undefined;

/**
 * Finishes a sign-in redirect if one is in progress and returns the signed-in
 * account, if any. Safe to call repeatedly.
 */
export function initAuth(): Promise<AccountInfo | null> {
  ready ??= (async () => {
    await msal.initialize();
    const result = await msal.handleRedirectPromise();
    const account = result?.account ?? msal.getAllAccounts()[0] ?? null;
    if (account) msal.setActiveAccount(account);
    return account;
  })();
  return ready;
}

/**
 * Who is using the site: someone signed in with their UK account, or, when
 * nobody is, the lab station this PC is registered as.
 */
export type Session =
  | { kind: "user"; account: AccountInfo }
  | { kind: "station"; station: LocalStation };

/** The current session, or null if the visitor has to sign in. */
export async function initSession(): Promise<Session | null> {
  const account = await initAuth();
  if (account) return { kind: "user", account };
  const station = await loadStation();
  return station ? { kind: "station", station } : null;
}

/**
 * `fresh` makes Microsoft ask for a password even if it remembers someone.
 * Used on lab stations, where the last person may not have signed out.
 */
export function signIn({ fresh = false }: { fresh?: boolean } = {}) {
  return msal.loginRedirect({
    ...loginRequest,
    ...(fresh ? { prompt: "login" } : {}),
  });
}

/** Signs out of Microsoft too, not just this site. */
export function signOut() {
  return msal.logoutRedirect({ account: msal.getActiveAccount() ?? undefined });
}

export function isStaff(account: AccountInfo) {
  const roles = account.idTokenClaims?.roles;
  return Array.isArray(roles) && roles.includes(STAFF_ROLE);
}

/** An access token for the API, refreshed silently when it has expired. */
export async function getAccessToken(): Promise<string> {
  const account = (await initAuth()) ?? msal.getActiveAccount();
  if (!account) {
    await msal.loginRedirect(loginRequest);
    throw new Error("Redirecting to sign in…");
  }
  try {
    const { accessToken } = await msal.acquireTokenSilent({
      ...loginRequest,
      account,
    });
    return accessToken;
  } catch (err) {
    // The session expired or consent changed: the user has to sign in again.
    if (err instanceof InteractionRequiredAuthError) {
      await msal.acquireTokenRedirect({ ...loginRequest, account });
      throw new Error("Redirecting to sign in…");
    }
    throw err;
  }
}
