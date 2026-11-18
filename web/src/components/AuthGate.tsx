import type { AccountInfo } from "@azure/msal-browser";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { initAuth, isStaff, keepsSignedIn, signIn, signOut } from "../auth";
import { AlertIcon, Spinner } from "../icons";

type State =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; account: AccountInfo }
  | { status: "error"; message: string };

const AccountContext = createContext<AccountInfo | null>(null);

/** The signed-in account. Only usable inside <AuthGate>. */
export function useAccount(): AccountInfo {
  const account = useContext(AccountContext);
  if (!account) throw new Error("useAccount must be used inside <AuthGate>.");
  return account;
}

/** The linkblue email the API records for this account (backend auth.ts). */
export function accountEmail(account: AccountInfo): string {
  return account.username.toLowerCase();
}

/** Renders its children only once the user has signed in with Entra ID. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [redirecting, setRedirecting] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(keepsSignedIn);

  useEffect(() => {
    initAuth().then(
      (account) =>
        setState(
          account ? { status: "signedIn", account } : { status: "signedOut" },
        ),
      (err: unknown) =>
        setState({
          status: "error",
          message:
            err instanceof Error ? err.message : "Sign-in failed. Try again.",
        }),
    );
  }, []);

  function redirect(action: () => Promise<void>) {
    setRedirecting(true);
    action().catch(() => setRedirecting(false));
  }

  if (state.status === "loading") {
    return (
      <main className="auth-loading" aria-busy="true">
        <Spinner />
      </main>
    );
  }

  if (state.status === "signedIn") {
    return (
      <AccountContext.Provider value={state.account}>
        <div className="user-bar">
          <span className="truncate">
            Signed in as <strong>{state.account.name ?? state.account.username}</strong>
          </span>
          {isStaff(state.account) && <span className="badge staff">STAFF</span>}
          <button
            type="button"
            className="button secondary small"
            onClick={() => redirect(signOut)}
            disabled={redirecting}
          >
            Sign out
          </button>
        </div>
        {children}
      </AccountContext.Provider>
    );
  }

  return (
    <main>
      <header className="hero">
        <h1>Innovation Center Laser Queue</h1>
        <p>Sign in with your University of Kentucky account to continue.</p>
      </header>
      <section className="card empty-state">
        {state.status === "error" && (
          <p className="notice error" role="alert">
            <AlertIcon />
            {state.message}
          </p>
        )}
        <button
          type="button"
          className="button"
          onClick={() => redirect(() => signIn({ keepSignedIn }))}
          disabled={redirecting}
        >
          {redirecting && <Spinner />}
          Sign in with linkblue
        </button>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={keepSignedIn}
            onChange={(event) => setKeepSignedIn(event.target.checked)}
            disabled={redirecting}
          />
          Keep this computer signed in
        </label>
        <p>
          {keepSignedIn
            ? "For the lab PC only. When Microsoft asks “Stay signed in?”, choose Yes. Sign out to turn this off."
            : "You'll be sent to the UK Microsoft sign-in page and then back here."}
        </p>
      </section>
    </main>
  );
}
