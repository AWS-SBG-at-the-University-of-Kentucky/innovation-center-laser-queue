import type { Analytics } from "./api";

// Turns the daily counts from GET /analytics into the figures on the
// analytics page. Every date is a lab-local YYYY-MM-DD string, so the date
// math here runs on whole day numbers in UTC and never shifts a day by the
// viewer's own time zone.

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD → days since 1970-01-01. */
export function dayNumber(date: string): number {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** Days since 1970-01-01 → YYYY-MM-DD. */
export function dayString(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday. */
export function weekday(day: number): number {
  return new Date(day * DAY_MS).getUTCDay();
}

/** The Sunday that starts `day`'s week. */
export function weekStart(day: number): number {
  return day - weekday(day);
}

/** YYYY-MM. */
function monthKey(date: string) {
  return date.slice(0, 7);
}

function previousMonth(month: string) {
  const [y = 1970, m = 1] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** A date to show on the page, read in UTC so it stays on the lab's day. */
export function asDate(dateOrMonth: string): Date {
  const [y = 1970, m = 1, d = 1] = dateOrMonth.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export interface Peak {
  /** YYYY-MM-DD (a day, or a week's Sunday) or YYYY-MM (a month). */
  key: string;
  count: number;
}

export interface MonthTotal {
  month: string;
  cut: number;
  submitted: number;
}

export interface Stats {
  totalCuts: number;
  totalSubmitted: number;
  /** First day with any activity, or null with no data at all. */
  firstDate: string | null;
  cutsByDay: Map<string, number>;
  thisWeek: number;
  lastWeek: number;
  thisMonth: number;
  lastMonth: number;
  thisYear: number;
  /** Only once there are two weeks of history to average over. */
  perWeek: number | null;
  busiestDay: Peak | null;
  busiestWeek: Peak | null;
  busiestMonth: Peak | null;
  /** Every month from the first with data to this one, oldest first. */
  months: MonthTotal[];
  /** Average cuts on each weekday (0 = Sunday) since the first day. */
  weekdayAverages: number[];
  /** Years with data, newest first. */
  years: number[];
}

function peak(totals: Map<string, number>): Peak | null {
  let best: Peak | null = null;
  for (const [key, count] of totals) {
    // Ties go to the earliest, which is the one that set the record.
    if (count > 0 && (!best || count > best.count)) best = { key, count };
  }
  return best;
}

function add(totals: Map<string, number>, key: string, count: number) {
  totals.set(key, (totals.get(key) ?? 0) + count);
}

export function computeStats(data: Analytics): Stats {
  const today = dayNumber(data.today);
  const thisWeekStart = weekStart(today);
  const thisMonth = monthKey(data.today);
  const lastMonth = previousMonth(thisMonth);
  const thisYear = data.today.slice(0, 4);

  const cutsByDay = new Map<string, number>();
  const weeks = new Map<string, number>();
  const monthTotals = new Map<string, MonthTotal>();
  const weekdayTotals = Array<number>(7).fill(0);
  const years = new Set<number>();

  const stats = {
    totalCuts: 0,
    totalSubmitted: 0,
    thisWeek: 0,
    lastWeek: 0,
    thisMonth: 0,
    lastMonth: 0,
    thisYear: 0,
  };

  for (const { date, cut, submitted } of data.days) {
    const day = dayNumber(date);
    const month = monthKey(date);
    stats.totalCuts += cut;
    stats.totalSubmitted += submitted;
    years.add(Number(date.slice(0, 4)));

    const monthTotal = monthTotals.get(month) ?? { month, cut: 0, submitted: 0 };
    monthTotal.cut += cut;
    monthTotal.submitted += submitted;
    monthTotals.set(month, monthTotal);

    if (cut === 0) continue;
    cutsByDay.set(date, cut);
    add(weeks, dayString(weekStart(day)), cut);
    const dow = weekday(day);
    weekdayTotals[dow] = (weekdayTotals[dow] ?? 0) + cut;

    if (weekStart(day) === thisWeekStart) stats.thisWeek += cut;
    if (weekStart(day) === thisWeekStart - 7) stats.lastWeek += cut;
    if (month === thisMonth) stats.thisMonth += cut;
    if (month === lastMonth) stats.lastMonth += cut;
    if (date.startsWith(thisYear)) stats.thisYear += cut;
  }

  const firstDate = data.days[0]?.date ?? null;

  // Every month from the first to now, so quiet months show as zero.
  const months: MonthTotal[] = [];
  if (firstDate) {
    const start = monthKey(firstDate);
    for (let m = thisMonth; m >= start; m = previousMonth(m)) {
      months.unshift(monthTotals.get(m) ?? { month: m, cut: 0, submitted: 0 });
    }
  }

  // How many of each weekday there have been, to turn totals into averages.
  const weekdayCounts = Array<number>(7).fill(0);
  if (firstDate) {
    for (let day = dayNumber(firstDate); day <= today; day++) {
      const dow = weekday(day);
      weekdayCounts[dow] = (weekdayCounts[dow] ?? 0) + 1;
    }
  }

  const daysOfHistory = firstDate ? today - dayNumber(firstDate) + 1 : 0;

  return {
    ...stats,
    firstDate,
    cutsByDay,
    perWeek: daysOfHistory >= 14 ? stats.totalCuts / (daysOfHistory / 7) : null,
    busiestDay: peak(cutsByDay),
    busiestWeek: peak(weeks),
    busiestMonth: peak(
      new Map(months.map(({ month, cut }) => [month, cut] as const)),
    ),
    months,
    weekdayAverages: weekdayTotals.map((total, i) => {
      const count = weekdayCounts[i] ?? 0;
      return count ? total / count : 0;
    }),
    years: [...years].sort((a, b) => b - a),
  };
}

/**
 * The two-hour window with the most submissions, as its starting hour, or
 * null without any submissions.
 */
export function busiestWindow(byHour: number[]): number | null {
  let best: number | null = null;
  let bestCount = 0;
  for (let hour = 0; hour < 24; hour++) {
    const count = (byHour[hour] ?? 0) + (byHour[hour + 1] ?? 0);
    if (count > bestCount) {
      best = hour;
      bestCount = count;
    }
  }
  return best;
}
