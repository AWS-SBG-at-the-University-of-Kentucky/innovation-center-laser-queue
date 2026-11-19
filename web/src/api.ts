import { getAccessToken, initSession } from "./auth";
import { stationHeaders } from "./station";

// Mirrors backend/src/types.ts — keep the two in sync.
export const ALLOWED_EXTENSIONS = ["ai"] as const;
export type FileExtension = (typeof ALLOWED_EXTENSIONS)[number];

// Mirrors MAX_FILE_SIZE_BYTES in infra/lib/laser-queue-stack.ts; the backend
// is what enforces it.
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

// Mirrors QUEUED_JOB_MAX_AGE_DAYS in infra/lib/laser-queue-stack.ts; the
// weekly cleanup is what enforces it. Shown to staff on the queue page.
export const QUEUED_JOB_MAX_AGE_DAYS = 14;

export interface Job {
  jobId: string;
  studentName: string;
  originalFileName: string;
  fileExtension: FileExtension;
  status: "QUEUED" | "COMPLETED";
  createdAt: string;
  completedAt?: string;
}

// GET /analytics. Mirrors backend/src/types.ts — keep the two in sync.

/** Activity on one day, in the lab's time zone. */
export interface DayActivity {
  /** YYYY-MM-DD in `Analytics.timeZone`. */
  date: string;
  /** Jobs submitted that day. */
  submitted: number;
  /** Jobs marked completed (cut) that day. */
  cut: number;
}

export interface Analytics {
  /** IANA time zone every date and hour below is in (the lab's). */
  timeZone: string;
  /** Today's date in `timeZone`, YYYY-MM-DD. */
  today: string;
  /** Jobs waiting right now. */
  queued: number;
  /** Jobs cleared from the queue for waiting too long, never cut. */
  expired: number;
  /** Days with at least one submission or cut, oldest first. */
  days: DayActivity[];
  /** Submissions by hour of day (index 0 = midnight), all time. */
  submittedByHour: number[];
  /** Median time from submission to being marked completed. */
  medianWaitMinutes: {
    allTime: number | null;
    last30Days: number | null;
  };
}

// Lab stations. Mirrors StationSummary in backend/src/types.ts — keep the two
// in sync.
export interface Station {
  stationId: string;
  name: string;
  createdAt: string;
  /** Name of the staff member who registered it. */
  createdBy: string;
  lastUsedAt?: string;
  lastUsedIp?: string;
}

// Mirrors MAX_STATIONS and MAX_STATION_NAME_LENGTH in
// backend/src/lib/stations.ts, which enforces them.
export const MAX_STATIONS = 20;
export const MAX_STATION_NAME_LENGTH = 60;

// The student's name comes from their sign-in token.
export interface CreateJobRequest {
  fileName: string;
  fileSize: number;
}

export interface CreateJobResponse {
  jobId: string;
  uploadUrl: string;
  /** The new job's place in line, counting from 1. */
  position: number;
}

const API_URL = import.meta.env.VITE_API_URL;

const STATION_REJECTED =
  "This PC isn't a lab station anymore, or its clock is wrong. A staff member " +
  "can sign in and register it again on the Stations page.";

/**
 * Calls the API as the signed-in user. With `stationAllowed`, a lab station
 * with nobody signed in calls the same route under /station instead, signed
 * with its key.
 */
async function request<T>(
  path: string,
  init: RequestInit = {},
  { stationAllowed = false }: { stationAllowed?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const session = stationAllowed ? await initSession() : null;
  const station = session?.kind === "station" ? session.station : null;
  const url = new URL(`${API_URL}${station ? "/station" : ""}${path}`);
  if (station) {
    const signed = await stationHeaders(station, init.method ?? "GET", url);
    for (const [name, value] of Object.entries(signed)) {
      headers.set(name, value);
    }
  } else {
    headers.set("authorization", `Bearer ${await getAccessToken()}`);
  }
  const res = await fetch(url, { ...init, headers });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // The station authorizer can't say why it refused.
    if (station && (res.status === 401 || res.status === 403)) {
      throw new Error(STATION_REJECTED);
    }
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

// Staff routes a lab station may also call.
const STATION = { stationAllowed: true };

export function createJob(input: CreateJobRequest) {
  return request<CreateJobResponse>("/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * Uploads straight to S3 using the presigned URL from createJob. Uses XHR
 * rather than fetch because fetch can't report upload progress.
 */
export function uploadFile(
  uploadUrl: string,
  file: File,
  onProgress?: (fraction: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () =>
      reject(new Error("Upload failed. Check your connection and try again."));
    xhr.send(file);
  });
}

/** How many jobs are waiting. Any signed-in student can ask for this. */
export function getQueueLength() {
  return request<{ queued: number }>("/queue/length");
}

export function listJobs() {
  return request<{ jobs: Job[] }>("/jobs", {}, STATION);
}

export function completeJob(jobId: string) {
  return request<{ job: Job }>(
    `/jobs/${jobId}/complete`,
    { method: "POST" },
    STATION,
  );
}

/** Removes the job and its file. The backend only allows this once completed. */
export function deleteJob(jobId: string) {
  return request<null>(`/jobs/${jobId}`, { method: "DELETE" }, STATION);
}

/** Usage counts for the analytics page. Staff only. */
export function getAnalytics() {
  return request<Analytics>("/analytics");
}

export function getDownloadUrl(jobId: string) {
  return request<{ downloadUrl: string }>(
    `/jobs/${jobId}/download`,
    {},
    STATION,
  );
}

/** Lab stations, oldest first. Staff signed in only. */
export function listStations() {
  return request<{ stations: Station[] }>("/stations");
}

/** Registers this PC as a station, given its public key. Staff signed in only. */
export function createStation(input: { name: string; publicKey: JsonWebKey }) {
  return request<{ station: Station }>("/stations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

/** Stops a station working, from its next request. Staff signed in only. */
export function deleteStation(stationId: string) {
  return request<null>(`/stations/${stationId}`, { method: "DELETE" });
}
