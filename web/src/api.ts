// Mirrors backend/src/types.ts — keep the two in sync.
export const ALLOWED_EXTENSIONS = ["ai", "pdf", "svg"] as const;
export type FileExtension = (typeof ALLOWED_EXTENSIONS)[number];

// Mirrors MAX_FILE_SIZE_BYTES in infra/lib/laser-queue-stack.ts; the backend
// is what enforces it.
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

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
  fileSize: number;
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

export function listJobs() {
  return request<{ jobs: Job[] }>("/jobs");
}

export function getDownloadUrl(jobId: string) {
  return request<{ downloadUrl: string }>(`/jobs/${jobId}/download`);
}
