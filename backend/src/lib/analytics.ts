import type { Analytics, DayActivity, JobRecord } from "../types.js";

/** The Innovation Center is in Lexington, KY. */
export const LAB_TIME_ZONE = "America/New_York";

const DAY_MS = 24 * 60 * 60 * 1000;

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: LAB_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** The lab-local date (YYYY-MM-DD) and hour (0-23) of a moment. */
function labTime(date: Date): { date: string; hour: number } {
  const parts: Record<string, string> = {};
  for (const { type, value } of partsFormat.formatToParts(date)) {
    parts[type] = value;
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
  };
}

function parse(timestamp: string | undefined): Date | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 ? upper : ((sorted[mid - 1] ?? upper) + upper) / 2;
}

type Timestamps = Pick<JobRecord, "status" | "createdAt" | "completedAt">;

/**
 * Rolls job records up into daily counts. Only timestamps are read, so
 * nothing about who submitted what leaves this function.
 */
export function summarize(records: Timestamps[], now = new Date()): Analytics {
  const days = new Map<string, DayActivity>();
  const day = (date: string) => {
    let entry = days.get(date);
    if (!entry) {
      entry = { date, submitted: 0, cut: 0 };
      days.set(date, entry);
    }
    return entry;
  };

  const submittedByHour = Array<number>(24).fill(0);
  const waits: number[] = [];
  const recentWaits: number[] = [];
  const recentSince = now.getTime() - 30 * DAY_MS;
  let queued = 0;
  let expired = 0;

  for (const record of records) {
    if (record.status === "QUEUED") queued++;
    if (record.status === "ARCHIVED" && !record.completedAt) expired++;

    const created = parse(record.createdAt);
    if (created) {
      const local = labTime(created);
      day(local.date).submitted++;
      submittedByHour[local.hour] = (submittedByHour[local.hour] ?? 0) + 1;
    }

    const completed = parse(record.completedAt);
    if (completed) {
      day(labTime(completed).date).cut++;
      if (created && completed >= created) {
        const minutes = (completed.getTime() - created.getTime()) / 60_000;
        waits.push(minutes);
        if (completed.getTime() >= recentSince) recentWaits.push(minutes);
      }
    }
  }

  return {
    timeZone: LAB_TIME_ZONE,
    today: labTime(now).date,
    queued,
    expired,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    submittedByHour,
    medianWaitMinutes: {
      allTime: median(waits),
      last30Days: median(recentWaits),
    },
  };
}
