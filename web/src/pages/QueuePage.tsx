import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  type Job,
  completeJob,
  deleteJob,
  getDownloadUrl,
  listJobs,
} from "../api";
import { PresenceNotice } from "../components/PresenceNotice";
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
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

function JobTable({
  jobs,
  loading,
  renderActions,
}: {
  /** null renders placeholder rows for the first load. */
  jobs: Job[] | null;
  loading: boolean;
  renderActions: (job: Job) => ReactNode;
}) {
  return (
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
                      <span className="truncate" title={job.originalFileName}>
                        {job.originalFileName}
                      </span>
                      <small>{job.fileExtension.toUpperCase()} file</small>
                    </td>
                    <td>
                      <span className={`badge ${job.status.toLowerCase()}`}>
                        {job.status}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">{renderActions(job)}</div>
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
  );
}

function DeleteDialog({
  job,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  job: Job;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // showModal (rather than the open attribute) is what traps focus and
  // gives the dialog its backdrop.
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="delete-dialog-title"
      // Fired by Escape; keep the dialog up while the delete is in flight.
      onCancel={(event) => {
        event.preventDefault();
        if (!deleting) onCancel();
      }}
      // The body covers the whole dialog, so a click that lands on the dialog
      // element itself can only have come from the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget && !deleting) onCancel();
      }}
    >
      <div className="modal-body">
        <h2 id="delete-dialog-title">Delete this job?</h2>
        <p>
          <strong className="break-anywhere">{job.originalFileName}</strong>{" "}
          from <strong>{job.studentName}</strong> and its uploaded file will be
          permanently deleted. This can't be undone.
        </p>
        {error && (
          <p className="notice error" role="alert">
            <AlertIcon />
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onCancel}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button danger"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting && <Spinner />}
            Delete
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function QueuePage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  async function complete(jobId: string) {
    setError(null);
    setCompletingId(jobId);
    try {
      const { job } = await completeJob(jobId);
      setJobs((current) =>
        current ? current.map((j) => (j.jobId === jobId ? job : j)) : current,
      );
    } catch (err) {
      setError(message(err));
    } finally {
      setCompletingId(null);
    }
  }

  function openDeleteDialog(job: Job) {
    setDeleteError(null);
    setJobToDelete(job);
  }

  async function confirmDelete() {
    if (!jobToDelete) return;
    const { jobId } = jobToDelete;
    setDeleteError(null);
    setDeleting(true);
    try {
      await deleteJob(jobId);
      setJobs((current) =>
        current ? current.filter((j) => j.jobId !== jobId) : current,
      );
      setJobToDelete(null);
    } catch (err) {
      setDeleteError(message(err));
    } finally {
      setDeleting(false);
    }
  }

  // The API returns jobs oldest first, which is the order the queue is cut in.
  const queued = jobs?.filter((job) => job.status === "QUEUED") ?? null;
  const completed = (jobs ?? [])
    .filter((job) => job.status === "COMPLETED")
    .sort((a, b) =>
      (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt),
    );

  function downloadButton(job: Job) {
    return (
      <button
        type="button"
        className="button small"
        onClick={() => download(job.jobId)}
        disabled={downloadingId === job.jobId}
      >
        {downloadingId === job.jobId ? <Spinner /> : <DownloadIcon />}
        Download
      </button>
    );
  }

  return (
    <main className="wide">
      <header className="page-header">
        <div>
          <h1>Laser Queue</h1>
          <p>
            {queued
              ? `${queued.length} ${queued.length === 1 ? "job" : "jobs"} waiting, oldest first.`
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

      <PresenceNotice />

      {error && (
        <p className="notice error" role="alert">
          <AlertIcon />
          {error}
        </p>
      )}

      {queued && queued.length === 0 && (
        <section className="card empty-state">
          <InboxIcon />
          <h2>No jobs in the queue</h2>
          <p>New submissions will show up here.</p>
        </section>
      )}

      {(queued ? queued.length > 0 : loading) && (
        <JobTable
          jobs={queued}
          loading={loading}
          renderActions={(job) => (
            <>
              {downloadButton(job)}
              <button
                type="button"
                className="button secondary small icon-only complete"
                aria-label={`Mark ${job.originalFileName} as completed`}
                title="Mark as completed"
                onClick={() => complete(job.jobId)}
                disabled={completingId === job.jobId}
              >
                {completingId === job.jobId ? <Spinner /> : <CheckIcon />}
              </button>
            </>
          )}
        />
      )}

      {completed.length > 0 && (
        <section>
          <header className="section-header">
            <h2>Completed</h2>
            <span>
              {completed.length} {completed.length === 1 ? "job" : "jobs"},
              most recent first
            </span>
          </header>
          <JobTable
            jobs={completed}
            loading={loading}
            renderActions={(job) => (
              <>
                {downloadButton(job)}
                <button
                  type="button"
                  className="button secondary small icon-only remove"
                  aria-label={`Delete ${job.originalFileName}`}
                  title="Delete job"
                  onClick={() => openDeleteDialog(job)}
                >
                  <CloseIcon />
                </button>
              </>
            )}
          />
        </section>
      )}

      {jobToDelete && (
        <DeleteDialog
          job={jobToDelete}
          deleting={deleting}
          error={deleteError}
          onCancel={() => setJobToDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </main>
  );
}
