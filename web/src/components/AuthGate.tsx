import type { AccountInfo } from "@azure/msal-browser";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { type Session, initSession, isStaff, signIn, signOut } from "../auth";
import { AlertIcon, Spinner } from "../icons";
import { loadStation } from "../station";
import { StaffNav } from "./StaffNav";

type State =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "ready"; session: Session; onStation: boolean }
  | { status: "error"; message: string };

const SessionContext = createContext<Session | null>(null);

/** Who is using the site. Only usable inside <AuthGate>. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <AuthGate>.");
  return session;
}

/**
 * The signed-in account. Only usable inside <AuthGate>, on pages a lab
 * station can't reach (App.tsx only gives stations the queue).
 */
export function useAccount(): AccountInfo {
  const session = useSession();
  if (session.kind !== "user") {
    throw new Error("useAccount needs someone signed in, not a lab station.");
  }
  return session.account;
}

/**
 * The account's linkblue email, shown so students can see which account
 * they're using. Display only: the API never stores it.
 */
export function accountEmail(account: AccountInfo): string {
  return account.username.toLowerCase();
}

/**
 * Renders its children once someone has signed in with Entra ID, or, if
 * nobody has, when this PC is a lab station.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    Promise.all([initSession(), loadStation()]).then(
      ([session, station]) =>
        setState(
          session
            ? { status: "ready", session, onStation: station !== null }
            : { status: "signedOut" },
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

  if (state.status === "ready" && state.session.kind === "station") {
    const { station } = state.session;
    return (
      <SessionContext.Provider value={state.session}>
        <header className="user-bar">
          <h1 className="app-title">IC Laser Queue</h1>
          <div className="user-info">
            <span className="truncate">
              <span className="signed-in-label">Lab station </span>
              <strong>{station.name}</strong>
            </span>
            <span className="badge staff">STATION</span>
            <button
              type="button"
              className="button secondary small"
              // Always asks for a password: the last person to sign in here
              // may still be remembered by Microsoft.
              onClick={() => redirect(() => signIn({ fresh: true }))}
              disabled={redirecting}
            >
              Staff sign in
            </button>
          </div>
        </header>
        {children}
      </SessionContext.Provider>
    );
  }

  if (state.status === "ready" && state.session.kind === "user") {
    const { account } = state.session;
    return (
      <SessionContext.Provider value={state.session}>
        <header className="user-bar">
          {/* The h1 for every signed-in page; pages start at h2. */}
          <h1 className="app-title">IC Laser Queue</h1>
          {/* Students only have the submit page, so they get no nav. */}
          {isStaff(account) && <StaffNav />}
          <div className="user-info">
            <span className="truncate">
              <span className="signed-in-label">Signed in as </span>
              <strong>{account.name ?? account.username}</strong>
            </span>
            {isStaff(account) && <span className="badge staff">STAFF</span>}
            <button
              type="button"
              className="button secondary small"
              onClick={() => redirect(signOut)}
              disabled={redirecting}
            >
              Sign out
            </button>
          </div>
        </header>
        {state.onStation && (
          <p className="station-reminder" role="note">
            <AlertIcon />
            <span>
              This PC is a lab station.{" "}
              <strong>Sign out when you're done</strong> so your UK account
              isn't left signed in. The queue stays open after you do.
            </span>
          </p>
        )}
        {children}
      </SessionContext.Provider>
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
          onClick={() => redirect(() => signIn())}
          disabled={redirecting}
        >
          {redirecting && <Spinner />}
          Sign in with linkblue
        </button>
        <p>
          You'll be sent to the UK Microsoft sign-in page and then back here.
        </p>
      </section>
    </main>
  );
}
