import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  MAX_STATION_NAME_LENGTH,
  MAX_STATIONS,
  type Station,
  createStation,
  deleteStation,
  listStations,
} from "../api";
import { signOut } from "../auth";
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  InboxIcon,
  RefreshIcon,
  Spinner,
} from "../icons";
import {
  type LocalStation,
  canBeStation,
  createStationKey,
  forgetStation,
  loadStation,
  saveStation,
} from "../station";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const relativeFormat = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

const COLUMNS = ["Name", "Registered", "Last used", "Action"];

function message(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** "just now", "5 minutes ago", "yesterday", or a date if it's been a while. */
function ago(iso: string) {
  const minutes = (Date.now() - Date.parse(iso)) / 60_000;
  if (minutes < 1) return "just now";
  if (minutes < 60)
    return relativeFormat.format(-Math.round(minutes), "minute");
  if (minutes < 24 * 60) {
    return relativeFormat.format(-Math.round(minutes / 60), "hour");
  }
  if (minutes < 7 * 24 * 60) {
    return relativeFormat.format(-Math.round(minutes / (24 * 60)), "day");
  }
  return dateFormat.format(new Date(iso));
}

/** Target for a Windows desktop shortcut that opens the queue on its own. */
function shortcutTarget() {
  return (
    `"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" ` +
    `--app=${window.location.origin}/queue --profile-directory="Laser Queue"`
  );
}

function RemoveDialog({
  station,
  isThisPc,
  removing,
  error,
  onCancel,
  onConfirm,
}: {
  station: Station;
  isThisPc: boolean;
  removing: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="remove-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!removing) onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !removing) onCancel();
      }}
    >
      <div className="modal-body">
        <h2 id="remove-dialog-title">Remove this station?</h2>
        <p>
          {isThisPc ? (
            "This PC"
          ) : (
            <strong className="break-anywhere">{station.name}</strong>
          )}{" "}
          will stop opening the queue straight away. To make it a station again,
          a staff member has to sign in on it and register it again.
        </p>
        {error && (
          <p className="notice error" role="alert">
            <AlertIcon />
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onCancel}
            disabled={removing}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button danger"
            onClick={onConfirm}
            disabled={removing}
          >
            {removing && <Spinner />}
            Remove
          </button>
        </div>
      </div>
    </dialog>
  );
}

function ThisPc({
  stations,
  local,
  onRegistered,
}: {
  stations: Station[] | null;
  local: LocalStation | null;
  onRegistered: (station: Station, local: LocalStation) => void;
}) {
  const [name, setName] = useState("Laser PC");
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justRegistered, setJustRegistered] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [copied, setCopied] = useState(false);

  const registered =
    local && stations?.find((s) => s.stationId === local.stationId);

  async function register(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give this PC a name, like “Laser PC”.");
      return;
    }
    setError(null);
    setRegistering(true);
    try {
      const { keyPair, publicKey } = await createStationKey();
      const { station } = await createStation({ name: trimmed, publicKey });
      const saved: LocalStation = {
        stationId: station.stationId,
        name: station.name,
        keyPair,
      };
      await saveStation(saved);
      setJustRegistered(true);
      onRegistered(station, saved);
    } catch (err) {
      setError(message(err));
    } finally {
      setRegistering(false);
    }
  }

  async function copyShortcut() {
    try {
      await navigator.clipboard.writeText(shortcutTarget());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked; the text is on screen to select by hand.
    }
  }

  let body;
  if (!canBeStation()) {
    body = (
      <p className="notice error" role="alert">
        <AlertIcon />
        This browser can't hold a station key. Use Microsoft Edge or Chrome, not
        a private window.
      </p>
    );
  } else if (stations === null) {
    body = <span className="skeleton" />;
  } else if (registered) {
    body = (
      <>
        <p>
          This PC is the lab station <strong>{registered.name}</strong>. When
          nobody is signed in, it opens straight to the queue.
        </p>
        {justRegistered ? (
          <div className="notice success" role="status">
            <CheckIcon />
            <div className="notice-content">
              <span>
                <strong>Registered.</strong> Now sign out, so your UK account
                isn't left signed in on this PC. The queue stays open.
              </span>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setSigningOut(true);
                  signOut().catch(() => setSigningOut(false));
                }}
                disabled={signingOut}
              >
                {signingOut && <Spinner />}
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <p className="muted">To stop it, remove it from the list below.</p>
        )}
      </>
    );
  } else {
    body = (
      <form className="station-form" onSubmit={register}>
        <p>
          Do this on the lab PC itself. Afterwards, sign out: the PC keeps
          access to the queue, but not to your UK account.
        </p>
        <label className="field">
          <span className="field-label">Station name</span>
          <input
            type="text"
            value={name}
            maxLength={MAX_STATION_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
            disabled={registering}
            required
          />
        </label>
        {error && (
          <p className="notice error" role="alert">
            <AlertIcon />
            {error}
          </p>
        )}
        <div>
          <button
            type="submit"
            className="button"
            disabled={registering || stations.length >= MAX_STATIONS}
          >
            {registering && <Spinner />}
            Register this PC
          </button>
        </div>
      </form>
    );
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2>This PC</h2>
      </div>
      <div className="card-body">
        {body}
        <details className="shortcut-help">
          <summary>Setting up the desktop shortcut</summary>
          <ol>
            <li>
              On the lab PC, right-click the desktop, choose{" "}
              <strong>New › Shortcut</strong>, and paste this as the location:
              <div className="shortcut-target">
                <code>{shortcutTarget()}</code>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={copyShortcut}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </li>
            <li>
              Open the shortcut, choose <strong>Staff sign in</strong> or{" "}
              <strong>Sign in</strong>, then open <strong>Stations</strong> and
              register the PC. Do it from the shortcut's window: its own Edge
              profile is where the key is kept.
            </li>
            <li>
              Sign out. From then on the shortcut opens the queue with nobody
              signed in.
            </li>
          </ol>
        </details>
      </div>
    </section>
  );
}

export function StationsPage() {
  const [stations, setStations] = useState<Station[] | null>(null);
  const [local, setLocal] = useState<LocalStation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<Station | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ stations }, local] = await Promise.all([
        listStations(),
        loadStation(),
      ]);
      setStations(stations);
      setLocal(local);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function confirmRemove() {
    if (!toRemove) return;
    const { stationId } = toRemove;
    setRemoveError(null);
    setRemoving(true);
    try {
      await deleteStation(stationId);
      if (local?.stationId === stationId) {
        await forgetStation();
        setLocal(null);
      }
      setStations((current) =>
        current ? current.filter((s) => s.stationId !== stationId) : current,
      );
      setToRemove(null);
    } catch (err) {
      setRemoveError(message(err));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <main className="wide">
      <header className="page-header">
        <div>
          <h2>Lab stations</h2>
          <p>
            A station is a PC that opens the queue with nobody signed in, so no
            one's UK account has to stay signed in on it. Its key only works for
            this queue and can't be copied off the PC.
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshIcon className={loading ? "icon spinning" : "icon"} />
          Refresh
        </button>
      </header>

      {error && (
        <p className="notice error" role="alert">
          <AlertIcon />
          {error}
        </p>
      )}

      <ThisPc
        stations={stations}
        local={local}
        onRegistered={(station, saved) => {
          setLocal(saved);
          setStations((current) => [...(current ?? []), station]);
        }}
      />

      <section>
        <header className="section-header">
          <h2>Registered stations</h2>
          {stations && (
            <span>
              {stations.length} of {MAX_STATIONS}
            </span>
          )}
        </header>

        {stations && stations.length === 0 ? (
          <section className="card empty-state">
            <InboxIcon />
            <h2>No stations yet</h2>
            <p>Register the lab PC from the PC itself, above.</p>
          </section>
        ) : (
          <div className="card table-scroll">
            <table className="queue-table stations-table" aria-busy={loading}>
              <colgroup>
                <col />
                <col className="col-registered" />
                <col className="col-last-used" />
                <col className="col-remove" />
              </colgroup>
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stations
                  ? stations.map((station) => (
                      <tr key={station.stationId}>
                        <td>
                          <span className="station-name">
                            <span className="truncate" title={station.name}>
                              {station.name}
                            </span>
                            {local?.stationId === station.stationId && (
                              <span className="badge">THIS PC</span>
                            )}
                          </span>
                        </td>
                        <td>
                          {dateFormat.format(new Date(station.createdAt))}
                          <small className="truncate" title={station.createdBy}>
                            by {station.createdBy}
                          </small>
                        </td>
                        <td>
                          {station.lastUsedAt
                            ? ago(station.lastUsedAt)
                            : "Never"}
                          {station.lastUsedIp && (
                            <small>from {station.lastUsedIp}</small>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button secondary small icon-only remove"
                            aria-label={`Remove ${station.name}`}
                            title="Remove station"
                            onClick={() => {
                              setRemoveError(null);
                              setToRemove(station);
                            }}
                          >
                            <CloseIcon />
                          </button>
                        </td>
                      </tr>
                    ))
                  : [0, 1].map((row) => (
                      <tr key={row}>
                        {COLUMNS.map((column) => (
                          <td key={column}>
                            <span className="skeleton" />
                          </td>
                        ))}
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {toRemove && (
        <RemoveDialog
          station={toRemove}
          isThisPc={local?.stationId === toRemove.stationId}
          removing={removing}
          error={removeError}
          onCancel={() => setToRemove(null)}
          onConfirm={confirmRemove}
        />
      )}
    </main>
  );
}
