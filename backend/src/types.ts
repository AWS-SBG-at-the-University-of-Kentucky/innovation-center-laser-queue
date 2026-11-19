export const ALLOWED_EXTENSIONS = ["ai"] as const;
export type FileExtension = (typeof ALLOWED_EXTENSIONS)[number];

export type JobStatus = "QUEUED" | "COMPLETED";

/**
 * One item in the LaserJobs table. The only personal detail stored is the
 * student's display name; their email and Entra ID are deliberately not kept.
 * Records from before that change may still have `studentEmail`/`studentId`
 * (see backend/scripts/strip-student-ids.ts).
 */
export interface Job {
  jobId: string;
  studentName: string;
  originalFileName: string;
  /** jobs/{jobId}/{filename} */
  s3Key: string;
  fileExtension: FileExtension;
  status: JobStatus;
  /** UTC ISO-8601 timestamp. */
  createdAt: string;
  /** UTC ISO-8601 timestamp; set when staff mark the job completed. */
  completedAt?: string;
}

/**
 * What a job becomes when staff delete it, or when the weekly cleanup clears
 * it: the file is gone and the student's name and file name are removed, but
 * the timestamps stay so analytics can still count it. Never returned by
 * GET /jobs.
 */
export interface ArchivedJob {
  jobId: string;
  status: "ARCHIVED";
  createdAt: string;
  /** Missing if the job expired in the queue without being cut. */
  completedAt?: string;
  /** UTC ISO-8601 timestamp; when staff deleted the job. */
  archivedAt: string;
}

/** Anything that can be in the table. */
export type JobRecord = Job | ArchivedJob;

/** What the API returns for a job; the S3 key stays server-side. */
export type JobSummary = Omit<Job, "s3Key">;

// GET /analytics. Mirrored in web/src/api.ts.

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
