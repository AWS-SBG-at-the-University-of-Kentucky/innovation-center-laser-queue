import {
  type AccountInfo,
  InteractionRequiredAuthError,
  PublicClientApplication,
} from "@azure/msal-browser";

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
  // MSAL clears its token cache when the browser closes whatever the storage,
  // so staying signed in relies on Microsoft's own cookie (see keepSignedIn).
  cache: { cacheLocation: "sessionStorage" },
});

const loginRequest = { scopes: [API_SCOPE] };

/**
 * Set on computers where someone ticked "Keep this computer signed in" (the lab
 * PC). The site then signs in automatically on load. If the user chose "Stay
 * signed in" at Microsoft, that redirect comes straight back without asking
 * for a password, even after the browser restarts.
 */
const KEEP_SIGNED_IN_KEY = "laserQueue.keepSignedIn";
/** Per tab: stops automatic sign-in looping if it fails or is cancelled. */
const AUTO_SIGN_IN_TRIED_KEY = "laserQueue.autoSignInTried";

function readFlag(storage: () => Storage, key: string) {
  try {
    return storage().getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(storage: () => Storage, key: string, on: boolean) {
  try {
    if (on) storage().setItem(key, "1");
    else storage().removeItem(key);
  } catch {
    // Storage blocked (private mode): fall back to signing in each visit.
  }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

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
    if (account) {
      msal.setActiveAccount(account);
      writeFlag(session, AUTO_SIGN_IN_TRIED_KEY, false);
      return account;
    }
    if (
      readFlag(local, KEEP_SIGNED_IN_KEY) &&
      !readFlag(session, AUTO_SIGN_IN_TRIED_KEY)
    ) {
      writeFlag(session, AUTO_SIGN_IN_TRIED_KEY, true);
      await msal.loginRedirect(loginRequest);
      // The page is navigating to Microsoft; stay on the loading state.
      return new Promise<never>(() => {});
    }
    return null;
  })();
  return ready;
}

/** Whether this computer is set to stay signed in. */
export function keepsSignedIn() {
  return readFlag(local, KEEP_SIGNED_IN_KEY);
}

export function signIn({ keepSignedIn }: { keepSignedIn: boolean }) {
  writeFlag(local, KEEP_SIGNED_IN_KEY, keepSignedIn);
  return msal.loginRedirect(loginRequest);
}

/** Signs out of Microsoft too, and stops this computer staying signed in. */
export function signOut() {
  writeFlag(local, KEEP_SIGNED_IN_KEY, false);
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
