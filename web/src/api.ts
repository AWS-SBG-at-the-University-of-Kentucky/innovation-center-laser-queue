// Mirrors backend/src/types.ts — keep the two in sync.
export const ALLOWED_EXTENSIONS = ["ai", "pdf", "svg"] as const;
export type FileExtension = (typeof ALLOWED_EXTENSIONS)[number];

export interface Job {
  jobId: string;
  studentName: string;
  studentEmail: string;
  originalFileName: string;
  fileExtension: FileExtension;
  status: "QUEUED" | "COMPLETED";
  createdAt: string;
}

export interface CreateJobRequest {
  studentName: string;
  studentEmail: string;
  fileName: string;
}

export interface CreateJobResponse {
  jobId: string;
  uploadUrl: string;
}

const API_URL = import.meta.env.VITE_API_URL;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
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

/** Uploads straight to S3 using the presigned URL from createJob. */
export async function uploadFile(uploadUrl: string, file: File) {
  const res = await fetch(uploadUrl, { method: "PUT", body: file });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

export function listJobs() {
  return request<{ jobs: Job[] }>("/jobs");
}

export function getDownloadUrl(jobId: string) {
  return request<{ downloadUrl: string }>(`/jobs/${jobId}/download`);
}
