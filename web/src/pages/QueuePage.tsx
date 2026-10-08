import { useCallback, useEffect, useState } from "react";
import { type Job, getDownloadUrl, listJobs } from "../api";
import {
  AlertIcon,
  DownloadIcon,
  InboxIcon,
  RefreshIcon,
  Spinner,
} from "../icons";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

const COLUMNS = ["Submitted", "Student", "Email", "File", "Status", "Action"];

function message(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function QueuePage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { jobs } = await listJobs();
      setJobs(jobs);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function download(jobId: string) {
    setError(null);
    setDownloadingId(jobId);
    try {
      const { downloadUrl } = await getDownloadUrl(jobId);
      window.location.assign(downloadUrl);
    } catch (err) {
      setError(message(err));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <main className="wide">
      <header className="page-header">
        <div>
          <h1>Laser Queue</h1>
          <p>
            {jobs
              ? `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"} waiting, oldest first.`
              : "Jobs waiting to be cut, oldest first."}
          </p>
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

      {jobs && jobs.length === 0 && (
        <section className="card empty-state">
          <InboxIcon />
          <h2>No jobs in the queue</h2>
          <p>New submissions will show up here.</p>
        </section>
      )}

      {(jobs ? jobs.length > 0 : loading) && (
        <div className="card table-scroll">
          <table className="queue-table" aria-busy={loading}>
            <colgroup>
              <col className="col-submitted" />
              <col className="col-student" />
              <col className="col-email" />
              <col />
              <col className="col-status" />
              <col className="col-action" />
            </colgroup>
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs
                ? jobs.map((job) => {
                    const created = new Date(job.createdAt);
                    return (
                      <tr key={job.jobId}>
                        <td>
                          {dateFormat.format(created)}
                          <small>{timeFormat.format(created)}</small>
                        </td>
                        <td>
                          <span className="truncate" title={job.studentName}>
                            {job.studentName}
                          </span>
                        </td>
                        <td>
                          <span className="truncate" title={job.studentEmail}>
                            {job.studentEmail}
                          </span>
                        </td>
                        <td>
                          <span
                            className="truncate"
                            title={job.originalFileName}
                          >
                            {job.originalFileName}
                          </span>
                          <small>{job.fileExtension.toUpperCase()} file</small>
                        </td>
                        <td>
                          <span
                            className={`badge ${job.status.toLowerCase()}`}
                          >
                            {job.status}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button small"
                            onClick={() => download(job.jobId)}
                            disabled={downloadingId === job.jobId}
                          >
                            {downloadingId === job.jobId ? (
                              <Spinner />
                            ) : (
                              <DownloadIcon />
                            )}
                            Download
                          </button>
                        </td>
                      </tr>
                    );
                  })
                : [0, 1, 2].map((row) => (
                    <tr key={row}>
                      {COLUMNS.map((column) => (
                        <td key={column}>
                          <span className="skeleton" />
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
