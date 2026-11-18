import { getAccessToken } from "./auth";

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${await getAccessToken()}`);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

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
  return request<{ jobs: Job[] }>("/jobs");
}

export function completeJob(jobId: string) {
  return request<{ job: Job }>(`/jobs/${jobId}/complete`, { method: "POST" });
}

/** Removes the job and its file. The backend only allows this once completed. */
export function deleteJob(jobId: string) {
  return request<null>(`/jobs/${jobId}`, { method: "DELETE" });
}

/** Usage counts for the analytics page. Staff only. */
export function getAnalytics() {
  return request<Analytics>("/analytics");
}

export function getDownloadUrl(jobId: string) {
  return request<{ downloadUrl: string }>(`/jobs/${jobId}/download`);
}
