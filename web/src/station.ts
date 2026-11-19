// This PC's lab station key, if it has one. A station is a PC (the lab PC)
// that can use the queue without anyone signed in, so nobody's UK account has
// to stay signed in on it. See "Lab stations" in docs/architecture.md.
//
// The private key is created non-extractable: the browser will sign with it,
// but won't hand it to any script, so it can't be copied off the PC. It lives
// in IndexedDB, which can store CryptoKey objects without exporting them.

/** Request headers a station sends. Mirrored in backend/src/lib/stations.ts. */
const HEADERS = {
  id: "x-station-id",
  time: "x-station-time",
  signature: "x-station-signature",
};

export interface LocalStation {
  stationId: string;
  name: string;
  keyPair: CryptoKeyPair;
}

const DB_NAME = "laserQueue";
const STORE = "station";
const RECORD = "current";

/** Whether this browser can be a station (needs HTTPS or localhost). */
export function canBeStation(): boolean {
  return (
    typeof indexedDB !== "undefined" &&
    typeof crypto !== "undefined" &&
    crypto.subtle !== undefined
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function inStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function isLocalStation(value: unknown): value is LocalStation {
  if (typeof value !== "object" || value === null) return false;
  const { stationId, name, keyPair } = value as Partial<LocalStation>;
  return (
    typeof stationId === "string" &&
    typeof name === "string" &&
    keyPair?.privateKey instanceof CryptoKey
  );
}

let loaded: Promise<LocalStation | null> | undefined;

/** This PC's station, or null if it isn't one. */
export function loadStation(): Promise<LocalStation | null> {
  loaded ??= canBeStation()
    ? inStore<unknown>("readonly", (store) => store.get(RECORD)).then(
        (value) => (isLocalStation(value) ? value : null),
        () => null,
      )
    : Promise.resolve(null);
  return loaded;
}

/**
 * Makes a new key pair for registering this PC. Only the public key is
 * returned in a form that can be sent anywhere.
 */
export async function createStationKey(): Promise<{
  keyPair: CryptoKeyPair;
  publicKey: JsonWebKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    // Not extractable: applies to the private key. Public keys always are.
    false,
    ["sign", "verify"],
  );
  const { kty, crv, x, y } = await crypto.subtle.exportKey(
    "jwk",
    keyPair.publicKey,
  );
  return { keyPair, publicKey: { kty, crv, x, y } };
}

/** Remembers this PC's station once the API has registered its key. */
export async function saveStation(station: LocalStation): Promise<void> {
  await inStore("readwrite", (store) => store.put(station, RECORD));
  loaded = Promise.resolve(station);
  // Asks the browser not to clear the key when the disk gets full. Browsers
  // may say no; the PC then just has to be registered again if it's cleared.
  void navigator.storage?.persist?.().catch(() => {});
}

/** Deletes this PC's key, so it stops being a station. */
export async function forgetStation(): Promise<void> {
  await inStore("readwrite", (store) => store.delete(RECORD));
  loaded = Promise.resolve(null);
}

function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Headers proving a request comes from this station. The signed text is
 * mirrored in signedMessage() in backend/src/lib/stations.ts.
 */
export async function stationHeaders(
  station: LocalStation,
  method: string,
  url: URL,
): Promise<Record<string, string>> {
  const time = String(Date.now());
  const message = [
    "laser-queue-station-v1",
    method.toUpperCase(),
    url.pathname,
    url.search.slice(1),
    time,
    station.stationId,
  ].join("\n");
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    station.keyPair.privateKey,
    new TextEncoder().encode(message),
  );
  return {
    [HEADERS.id]: station.stationId,
    [HEADERS.time]: time,
    [HEADERS.signature]: base64url(signature),
  };
}
