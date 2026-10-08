import { useCallback, useEffect, useState } from "react";
import { type Job, getDownloadUrl, listJobs } from "../api";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function message(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function QueuePage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const { downloadUrl } = await getDownloadUrl(jobId);
      window.location.assign(downloadUrl);
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <main className="wide">
      <header className="page-header">
        <h1>Laser Queue</h1>
        <button type="button" onClick={refresh} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {jobs && jobs.length === 0 && <p>No jobs in the queue.</p>}

      {jobs && jobs.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Submitted</th>
              <th>Student</th>
              <th>File</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {jobs.map((job, index) => (
              <tr key={job.jobId}>
                <td>{index + 1}</td>
                <td>{dateFormat.format(new Date(job.createdAt))}</td>
                <td>
                  {job.studentName}
                  <br />
                  <small>{job.studentEmail}</small>
                </td>
                <td>{job.originalFileName}</td>
                <td>
                  <button type="button" onClick={() => download(job.jobId)}>
                    Download
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
