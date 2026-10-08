export const ALLOWED_EXTENSIONS = ["ai", "pdf", "svg"] as const;
export type FileExtension = (typeof ALLOWED_EXTENSIONS)[number];

export type JobStatus = "QUEUED" | "COMPLETED";

/** One item in the LaserJobs table. */
export interface Job {
  jobId: string;
  studentName: string;
  studentEmail: string;
  originalFileName: string;
  /** jobs/{jobId}/{filename} */
  s3Key: string;
  fileExtension: FileExtension;
  status: JobStatus;
  /** UTC ISO-8601 timestamp. */
  createdAt: string;
}
