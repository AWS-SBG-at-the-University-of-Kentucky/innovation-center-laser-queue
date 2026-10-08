import { type DragEvent, type FormEvent, useState } from "react";
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  createJob,
  uploadFile,
} from "../api";
import {
  AlertIcon,
  AnimatedCheck,
  CloseIcon,
  FileIcon,
  Spinner,
  UploadCloudIcon,
} from "../icons";

const ACCEPT = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(",");
const ACCEPT_LABEL = ACCEPT.replaceAll(",", ", ");
const MAX_FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / (1024 * 1024);

type Status =
  | { state: "idle" }
  // progress is null until the S3 upload itself starts.
  | { state: "submitting"; progress: number | null }
  | { state: "success"; fileName: string }
  | { state: "error"; message: string };

function checkFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((allowed) => allowed === ext)) {
    return `File must be one of: ${ACCEPT_LABEL}.`;
  }
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File must be ${MAX_FILE_SIZE_MB} MB or smaller.`;
  }
  return null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SubmitPage() {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const submitting = status.state === "submitting";
  const percent =
    status.state === "submitting" && status.progress !== null
      ? Math.round(status.progress * 100)
      : null;

  function selectFile(next: File | undefined) {
    if (!next || submitting) return;
    const fileError = checkFile(next);
    if (fileError) {
      setStatus({ state: "error", message: fileError });
      return;
    }
    setFile(next);
    setStatus({ state: "idle" });
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    // Without this the browser opens the dropped file instead.
    event.preventDefault();
    if (!submitting) setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    // Ignore leave events fired when moving over a child element.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files[0]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (!file) {
      setStatus({ state: "error", message: "Choose a file to upload." });
      return;
    }
    const data = new FormData(event.currentTarget);

    setStatus({ state: "submitting", progress: null });
    try {
      const { uploadUrl } = await createJob({
        studentName: String(data.get("studentName")),
        studentEmail: String(data.get("studentEmail")),
        fileName: file.name,
        fileSize: file.size,
      });
      await uploadFile(uploadUrl, file, (progress) =>
        setStatus({ state: "submitting", progress }),
      );
      setFile(null);
      setStatus({ state: "success", fileName: file.name });
    } catch (err) {
      setStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  }

  return (
    <main>
      <header className="hero">
        <h1>Innovation Center Laser Queue</h1>
        <p>Submit a file for laser cutting.</p>
      </header>

      {status.state === "success" ? (
        <section className="card success-panel" role="status">
          <AnimatedCheck />
          <h2>Job submitted</h2>
          <p>
            <strong className="break-anywhere">{status.fileName}</strong> is in
            the laser queue. Innovation Center staff will cut it in the order
            it was received.
          </p>
          <button
            type="button"
            className="button"
            onClick={() => setStatus({ state: "idle" })}
          >
            Submit another file
          </button>
        </section>
      ) : (
        <section className="card">
          <h2 className="card-header">Submit a New Job</h2>
          <form className="card-body" onSubmit={handleSubmit}>
            <label className="field">
              <span className="field-label">Name</span>
              <input
                name="studentName"
                placeholder="Enter your full name"
                autoComplete="name"
                maxLength={100}
                readOnly={submitting}
                required
              />
            </label>
            <label className="field">
              <span className="field-label">Student Email</span>
              <input
                name="studentEmail"
                type="email"
                placeholder="linkblue@uky.edu"
                autoComplete="email"
                readOnly={submitting}
                required
              />
            </label>

            <div className="field">
              <span className="field-label">File Upload</span>
              <div
                className={dragging ? "drop-target dragging" : "drop-target"}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {file ? (
                  <div className="file-card">
                    <span className="file-card-icon">
                      <FileIcon />
                    </span>
                    <div className="file-card-text">
                      <span className="truncate" title={file.name}>
                        {file.name}
                      </span>
                      <small>
                        {submitting
                          ? percent === null
                            ? "Preparing upload…"
                            : percent < 100
                              ? `Uploading… ${percent}%`
                              : "Finishing up…"
                          : formatBytes(file.size)}
                      </small>
                    </div>
                    {!submitting && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Remove file"
                        onClick={() => setFile(null)}
                      >
                        <CloseIcon />
                      </button>
                    )}
                    {submitting && (
                      <div
                        className={
                          percent === null
                            ? "progress indeterminate"
                            : "progress"
                        }
                        role="progressbar"
                        aria-label="Upload progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent ?? undefined}
                      >
                        <div
                          className="progress-bar"
                          style={{ width: `${percent ?? 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <label className="dropzone">
                    <input
                      className="visually-hidden"
                      type="file"
                      accept={ACCEPT}
                      onChange={(event) => {
                        selectFile(event.target.files?.[0]);
                        // Lets the same file be picked again after an error.
                        event.target.value = "";
                      }}
                    />
                    <UploadCloudIcon />
                    <span>
                      {dragging
                        ? "Drop your file to add it"
                        : "Drag and drop your file here, or click to browse"}
                    </span>
                    <small>
                      Accepted file types: {ACCEPT_LABEL} — up to{" "}
                      {MAX_FILE_SIZE_MB} MB
                    </small>
                  </label>
                )}
              </div>
            </div>

            {status.state === "error" && (
              <p className="notice error" role="alert">
                <AlertIcon />
                {status.message}
              </p>
            )}

            <button
              type="submit"
              className="button block"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Spinner />
                  Uploading…
                </>
              ) : (
                "Submit Job"
              )}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
