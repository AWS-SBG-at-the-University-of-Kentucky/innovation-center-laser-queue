import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Analytics, getAnalytics } from "../api";
import {
  type Stats,
  asDate,
  busiestWindow,
  computeStats,
  dayNumber,
  dayString,
  weekStart,
  weekday,
} from "../analytics";
import {
  AlertIcon,
  ChartIcon,
  CheckIcon,
  CopyIcon,
  RefreshIcon,
} from "../icons";

// Dates arrive as lab-local calendar days and asDate() puts them at UTC
// midnight, so every formatter reads them in UTC.
const UTC = { timeZone: "UTC" } as const;
const fullDate = new Intl.DateTimeFormat("en-US", {
  ...UTC,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const shortDate = new Intl.DateTimeFormat("en-US", {
  ...UTC,
  month: "short",
  day: "numeric",
  year: "numeric",
});
const monthYear = new Intl.DateTimeFormat("en-US", {
  ...UTC,
  month: "long",
  year: "numeric",
});
const shortMonth = new Intl.DateTimeFormat("en-US", { ...UTC, month: "short" });
const longWeekday = new Intl.DateTimeFormat("en-US", {
  ...UTC,
  weekday: "long",
});
const integer = new Intl.NumberFormat("en-US");
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// 2023-01-01 was a Sunday; used to name weekdays.
const FIRST_SUNDAY = dayNumber("2023-01-01");

function jobs(n: number) {
  return `${integer.format(n)} ${n === 1 ? "job" : "jobs"}`;
}

function weekdayName(index: number) {
  return longWeekday.format(asDate(dayString(FIRST_SUNDAY + index)));
}

function formatDuration(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 48 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
  }
  return `${decimal.format(minutes / (24 * 60))} days`;
}

function hourLabel(hour: number, long = false) {
  const h = hour % 12 || 12;
  const suffix = hour < 12 ? (long ? " AM" : "a") : long ? " PM" : "p";
  return `${h}${suffix}`;
}

function message(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/* Tooltip shared by every chart */

interface Tip {
  x: number;
  y: number;
  below: boolean;
  title: string;
  detail?: string;
}

/**
 * Hover/tap tooltip for a chart. `ref` goes on the chart's positioned
 * wrapper; `bind()` goes on each mark.
 */
function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  function bind(title: string, detail?: string) {
    return {
      onPointerEnter: (event: PointerEvent<HTMLElement>) => {
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        const mark = event.currentTarget.getBoundingClientRect();
        const top = mark.top - box.top;
        // Keep the tooltip inside the chart, and below marks near the top.
        const x = Math.min(
          Math.max(mark.left + mark.width / 2 - box.left, 80),
          box.width - 80,
        );
        const below = top < 56;
        setTip({ x, y: below ? top + mark.height : top, below, title, detail });
      },
      onPointerLeave: () => setTip(null),
    };
  }

  const node = tip && (
    <div
      className={tip.below ? "chart-tip below" : "chart-tip"}
      style={{ left: tip.x, top: tip.y }}
      aria-hidden="true"
    >
      <strong>{tip.title}</strong>
      {tip.detail && <span>{tip.detail}</span>}
    </div>
  );

  return { ref, bind, node };
}

/* Column chart */

interface Column {
  key: string;
  label: string;
  value: number;
  tip: string;
  detail?: string;
}

/** 0 to a round number at or above max, in at most four steps. */
function ticksFor(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ??
    10 * magnitude;
  const ticks = [];
  for (let t = 0; t < max + step; t += step) {
    ticks.push(Number(t.toFixed(6)));
    if (t >= max) break;
  }
  return ticks;
}

function ColumnChart({
  columns,
  label,
  format = integer.format,
  showLabel = () => true,
}: {
  columns: Column[];
  /** Read out for screen readers; the table view has the numbers. */
  label: string;
  format?: (n: number) => string;
  /** Which x-axis labels to print, when there are too many to fit. */
  showLabel?: (index: number) => boolean;
}) {
  const { ref, bind, node } = useTooltip();
  const max = Math.max(0, ...columns.map((c) => c.value));
  const ticks = ticksFor(max);
  const top = ticks[ticks.length - 1] ?? 1;
  // Only the tallest column gets its value printed on it.
  const peakIndex = max > 0 ? columns.findIndex((c) => c.value === max) : -1;

  return (
    <div className="column-chart" ref={ref} role="img" aria-label={label}>
      <div className="plot">
        {ticks.map((tick) => (
          <div
            key={tick}
            className="gridline"
            style={{ bottom: `${(tick / top) * 100}%` }}
          >
            <span>{format(tick)}</span>
          </div>
        ))}
        <div className="columns">
          {columns.map((column, index) => (
            <div
              key={column.key}
              className="column"
              {...bind(column.tip, column.detail)}
            >
              {index === peakIndex && (
                <span
                  className="cap-label"
                  style={{ bottom: `${(column.value / top) * 100}%` }}
                >
                  {format(column.value)}
                </span>
              )}
              <div
                className={column.value > 0 ? "bar" : "bar zero"}
                style={{ height: `${(column.value / top) * 100}%` }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="column-labels" aria-hidden="true">
        {columns.map((column, index) => (
          <span key={column.key}>{showLabel(index) ? column.label : ""}</span>
        ))}
      </div>
      {node}
    </div>
  );
}

/* Calendar heat map */

type Range = "past" | number;

function CalendarHeatmap({
  stats,
  today,
}: {
  stats: Stats;
  today: string;
}) {
  const [range, setRange] = useState<Range>("past");
  const { ref, bind, node } = useTooltip();
  const scrollRef = useRef<HTMLDivElement>(null);

  const todayNumber = dayNumber(today);
  const start =
    range === "past"
      ? weekStart(todayNumber) - 52 * 7
      : dayNumber(`${range}-01-01`);
  const end =
    range === "past"
      ? todayNumber
      : Math.min(dayNumber(`${range}-12-31`), todayNumber);
  const gridStart = weekStart(start);
  const columnCount = (weekStart(end) - gridStart) / 7 + 1;

  const days: { date: string; day: number; count: number }[] = [];
  for (let day = start; day <= end; day++) {
    const date = dayString(day);
    days.push({ date, day, count: stats.cutsByDay.get(date) ?? 0 });
  }
  const max = Math.max(0, ...days.map((d) => d.count));
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const activeDays = days.filter((d) => d.count > 0).length;
  const level = (count: number) =>
    count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4));

  // A month label sits over the week that holds the 1st.
  const monthLabels = days
    .filter((d) => d.date.endsWith("-01"))
    .map((d) => ({
      column: (weekStart(d.day) - gridStart) / 7,
      label: shortMonth.format(asDate(d.date)),
    }));

  // On narrow screens the grid scrolls; start at the most recent weeks.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [range]);

  const rangeLabel = range === "past" ? "the past year" : String(range);

  return (
    <section className="card chart-card">
      <header className="chart-header">
        <div>
          <h3>Jobs cut per day</h3>
          <p>
            {jobs(total)} in {rangeLabel}, on {integer.format(activeDays)}{" "}
            {activeDays === 1 ? "day" : "days"}
          </p>
        </div>
        <label className="select">
          <span className="visually-hidden">Date range</span>
          <select
            value={String(range)}
            onChange={(event) =>
              setRange(
                event.target.value === "past"
                  ? "past"
                  : Number(event.target.value),
              )
            }
          >
            <option value="past">Past year</option>
            {stats.years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="heatmap-scroll" ref={scrollRef}>
        <div
          className="heatmap"
          ref={ref}
          role="img"
          aria-label={`Calendar of jobs cut per day in ${rangeLabel}: ${jobs(total)}, busiest day ${max}.`}
          style={{
            gridTemplateColumns: `1.75rem repeat(${columnCount}, minmax(0, 1fr))`,
            minWidth: `calc(1.75rem + ${columnCount} * 0.875rem)`,
          }}
        >
          {monthLabels.map(({ column, label }) => (
            <span
              key={`${label}-${column}`}
              className="heatmap-month"
              style={{ gridColumn: column + 2, gridRow: 1 }}
            >
              {label}
            </span>
          ))}
          {[1, 3, 5].map((row) => (
            <span
              key={row}
              className="heatmap-weekday"
              style={{ gridColumn: 1, gridRow: row + 2 }}
            >
              {WEEKDAYS[row]}
            </span>
          ))}
          {days.map(({ date, day, count }) => (
            <div
              key={date}
              className={`heat-cell level-${level(count)}`}
              style={{
                gridColumn: (weekStart(day) - gridStart) / 7 + 2,
                gridRow: weekday(day) + 2,
              }}
              {...bind(
                count === 0 ? "No jobs cut" : `${jobs(count)} cut`,
                fullDate.format(asDate(date)),
              )}
            />
          ))}
          {node}
        </div>
      </div>

      <footer className="heatmap-legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heat-cell level-${l}`} />
        ))}
        <span>More</span>
      </footer>
    </section>
  );
}

/* Page sections */

function talkingPoints(data: Analytics, stats: Stats): string[] {
  const points: string[] = [];
  if (!stats.firstDate) return points;

  const since = monthYear.format(asDate(stats.firstDate));
  points.push(
    `The Innovation Center laser has cut ${jobs(stats.totalCuts)} since ${since}` +
      (stats.perWeek !== null
        ? `, about ${decimal.format(stats.perWeek)} a week.`
        : "."),
  );
  if (stats.busiestDay) {
    points.push(
      `Record day: ${jobs(stats.busiestDay.count)} cut on ${fullDate.format(asDate(stats.busiestDay.key))}.`,
    );
  }
  if (stats.busiestMonth && stats.months.length > 1) {
    points.push(
      `Busiest month: ${monthYear.format(asDate(stats.busiestMonth.key))}, with ${jobs(stats.busiestMonth.count)} cut.`,
    );
  }
  const topAverage = Math.max(...stats.weekdayAverages);
  if (stats.perWeek !== null && topAverage > 0) {
    const topWeekday = stats.weekdayAverages.indexOf(topAverage);
    points.push(
      `${weekdayName(topWeekday)}s are the busiest day of the week, averaging ${decimal.format(topAverage)} jobs.`,
    );
  }
  const window = busiestWindow(data.submittedByHour);
  if (window !== null) {
    points.push(
      `Most jobs come in between ${hourLabel(window, true)} and ${hourLabel((window + 2) % 24, true)}.`,
    );
  }
  if (data.medianWaitMinutes.allTime !== null) {
    points.push(
      `Half of all jobs are cut within ${formatDuration(data.medianWaitMinutes.allTime)} of being submitted.`,
    );
  }
  return points;
}

function Headline({ data, stats }: { data: Analytics; stats: Stats }) {
  const points = talkingPoints(data, stats);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(points.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked; the text is on screen to select by hand.
    }
  }

  return (
    <section className="card headline">
      <div className="headline-figure">
        <span className="hero-number">{integer.format(stats.totalCuts)}</span>
        <span className="hero-label">
          laser {stats.totalCuts === 1 ? "job" : "jobs"} cut
          {stats.firstDate && (
            <> since {shortDate.format(asDate(stats.firstDate))}</>
          )}
        </span>
        <span className="hero-sub">
          from {jobs(stats.totalSubmitted)} submitted
          {data.expired > 0 &&
            ` · ${integer.format(data.expired)} expired without being cut`}
        </span>
      </div>
      <div className="talking-points">
        <div className="talking-points-header">
          <h3>Talking points</h3>
          <button
            type="button"
            className="button secondary small"
            onClick={copy}
            disabled={points.length === 0}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <ul>
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="card stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

function StatTiles({ data, stats }: { data: Analytics; stats: Stats }) {
  return (
    <div className="stat-grid">
      <StatTile
        label="This week"
        value={integer.format(stats.thisWeek)}
        sub={`Last week: ${integer.format(stats.lastWeek)}`}
      />
      <StatTile
        label="This month"
        value={integer.format(stats.thisMonth)}
        sub={`Last month: ${integer.format(stats.lastMonth)}`}
      />
      <StatTile
        label={`So far in ${data.today.slice(0, 4)}`}
        value={integer.format(stats.thisYear)}
        sub="Jobs cut"
      />
      <StatTile
        label="Median wait, last 30 days"
        value={formatDuration(data.medianWaitMinutes.last30Days)}
        sub={`All time: ${formatDuration(data.medianWaitMinutes.allTime)}`}
      />
      <StatTile
        label="In the queue now"
        value={integer.format(data.queued)}
        sub={data.queued === 1 ? "Job waiting" : "Jobs waiting"}
      />
    </div>
  );
}

function Records({ stats }: { stats: Stats }) {
  const records = [
    {
      label: "Busiest day",
      peak: stats.busiestDay,
      when: (key: string) => fullDate.format(asDate(key)),
    },
    {
      label: "Busiest week",
      peak: stats.busiestWeek,
      when: (key: string) => `Week of ${shortDate.format(asDate(key))}`,
    },
    {
      label: "Busiest month",
      peak: stats.busiestMonth,
      when: (key: string) => monthYear.format(asDate(key)),
    },
  ];
  return (
    <div className="record-grid">
      {records.map(({ label, peak, when }) => (
        <StatTile
          key={label}
          label={label}
          value={peak ? jobs(peak.count) : "—"}
          sub={peak ? when(peak.key) : "No jobs cut yet"}
        />
      ))}
    </div>
  );
}

function MonthlyChart({ data, stats }: { data: Analytics; stats: Stats }) {
  // The chart shows the last year; the table below has every month.
  const recent = stats.months.slice(-12);
  const columns = recent.map(({ month, cut, submitted }) => {
    const date = asDate(month);
    return {
      key: month,
      label: shortMonth.format(date),
      value: cut,
      tip: `${jobs(cut)} cut`,
      detail: `${monthYear.format(date)} · ${integer.format(submitted)} submitted`,
    };
  });

  return (
    <section className="card chart-card">
      <header className="chart-header">
        <div>
          <h3>Jobs cut per month</h3>
          <p>
            {recent.length < stats.months.length
              ? "Last 12 months"
              : `Since ${monthYear.format(asDate(stats.firstDate ?? data.today))}`}
          </p>
        </div>
      </header>
      <ColumnChart
        columns={columns}
        label={`Jobs cut per month. ${columns.map((c) => `${c.detail?.split(" · ")[0]}: ${c.value}`).join(", ")}.`}
      />
      <details className="table-view">
        <summary>Show every month as a table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Submitted</th>
              <th scope="col">Cut</th>
            </tr>
          </thead>
          <tbody>
            {[...stats.months].reverse().map(({ month, cut, submitted }) => (
              <tr key={month}>
                <th scope="row">{monthYear.format(asDate(month))}</th>
                <td>{integer.format(submitted)}</td>
                <td>{integer.format(cut)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function WeekdayChart({ stats }: { stats: Stats }) {
  const columns = stats.weekdayAverages.map((average, index) => ({
    key: String(index),
    label: WEEKDAYS[index] ?? "",
    value: average,
    tip: `${decimal.format(average)} jobs on average`,
    detail: `${weekdayName(index)}s`,
  }));
  return (
    <section className="card chart-card">
      <header className="chart-header">
        <div>
          <h3>Average jobs cut by weekday</h3>
          <p>Which days the laser is busiest</p>
        </div>
      </header>
      <ColumnChart
        columns={columns}
        format={decimal.format}
        label={`Average jobs cut per weekday. ${columns.map((c) => `${c.detail}: ${decimal.format(c.value)}`).join(", ")}.`}
      />
    </section>
  );
}

function HourChart({ data }: { data: Analytics }) {
  const byHour = data.submittedByHour;
  const used = byHour.flatMap((count, hour) => (count > 0 ? [hour] : []));
  // Always show the working day, widened to any hour that has submissions.
  const first = Math.min(8, ...used);
  const last = Math.max(19, ...used);
  const columns = [];
  for (let hour = first; hour <= last; hour++) {
    const count = byHour[hour] ?? 0;
    columns.push({
      key: String(hour),
      label: hourLabel(hour),
      value: count,
      tip: `${jobs(count)} submitted`,
      detail: `${hourLabel(hour, true)} – ${hourLabel((hour + 1) % 24, true)}`,
    });
  }
  return (
    <section className="card chart-card">
      <header className="chart-header">
        <div>
          <h3>When jobs come in</h3>
          <p>Submissions by hour, all time (Eastern)</p>
        </div>
      </header>
      <ColumnChart
        columns={columns}
        showLabel={(index) => (first + index) % 3 === 0}
        label={`Submissions by hour of day. ${columns.map((c) => `${c.detail}: ${c.value}`).join(", ")}.`}
      />
    </section>
  );
}

function LoadingState() {
  return (
    <div className="analytics" aria-busy="true">
      <div className="card headline">
        <span className="skeleton" style={{ width: "40%", height: "3rem" }} />
        <span className="skeleton" />
      </div>
      <div className="stat-grid">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="card stat-tile">
            <span className="skeleton" />
            <span className="skeleton" style={{ height: "1.75rem" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getAnalytics());
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stats = useMemo(() => (data ? computeStats(data) : null), [data]);

  return (
    <main className="wide">
      <header className="page-header">
        <div className="section-title">
          <h2>Analytics</h2>
          <span>How much the laser gets used · times in Eastern</span>
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

      {!data || !stats ? (
        loading && <LoadingState />
      ) : !stats.firstDate ? (
        <section className="card empty-state">
          <ChartIcon />
          <h2>No jobs yet</h2>
          <p>Stats will show up here once students start submitting.</p>
        </section>
      ) : (
        <div className="analytics">
          <Headline data={data} stats={stats} />
          <StatTiles data={data} stats={stats} />
          <CalendarHeatmap stats={stats} today={data.today} />
          <h3 className="analytics-section">Records</h3>
          <Records stats={stats} />
          <MonthlyChart data={data} stats={stats} />
          <div className="chart-pair">
            <WeekdayChart stats={stats} />
            <HourChart data={data} />
          </div>
        </div>
      )}
    </main>
  );
}
