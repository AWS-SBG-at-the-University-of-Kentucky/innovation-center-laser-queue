import { type DragEvent, type FormEvent, useEffect, useState } from "react";
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  createJob,
  getQueueLength,
  uploadFile,
} from "../api";
import { accountEmail, useAccount } from "../components/AuthGate";
import { PresenceNotice } from "../components/PresenceNotice";
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
  | { state: "success"; fileName: string; position: number }
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

const ordinalRules = new Intl.PluralRules("en-US", { type: "ordinal" });
const ORDINAL_SUFFIX: Partial<Record<Intl.LDMLPluralRule, string>> = {
  one: "st",
  two: "nd",
  few: "rd",
};

/** 1 → "1st", 2 → "2nd", 8 → "8th", 22 → "22nd". */
function ordinal(n: number) {
  return `${n}${ORDINAL_SUFFIX[ordinalRules.select(n)] ?? "th"}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SubmitPage() {
  const account = useAccount();
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  // null while loading, or if it failed: the count is a nice-to-have, so the
  // page just leaves it out rather than showing an error.
  const [queueLength, setQueueLength] = useState<number | null>(null);

  // Reloads after each successful submission so the count includes it.
  const submittedFile = status.state === "success" ? status.fileName : null;
  useEffect(() => {
    let cancelled = false;
    getQueueLength().then(
      ({ queued }) => !cancelled && setQueueLength(queued),
      () => !cancelled && setQueueLength(null),
    );
    return () => {
      cancelled = true;
    };
  }, [submittedFile]);

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
    setStatus({ state: "submitting", progress: null });
    try {
      const { uploadUrl, position } = await createJob({
        fileName: file.name,
        fileSize: file.size,
      });
      await uploadFile(uploadUrl, file, (progress) =>
        setStatus({ state: "submitting", progress }),
      );
      setFile(null);
      setStatus({ state: "success", fileName: file.name, position });
    } catch (err) {
      setStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  }

  return (
    <main>
      {/* The page's h1 is the site title in the top bar (AuthGate). */}
      <PresenceNotice />

      {status.state === "success" ? (
        <section className="card success-panel" role="status">
          <AnimatedCheck />
          <h2>Job submitted</h2>
          <p className="queue-position">
            {status.position === 1 ? (
              <>
                You're <strong>next</strong> in line
              </>
            ) : (
              <>
                You're <strong>{ordinal(status.position)}</strong> in line
              </>
            )}
          </p>
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
          <div className="card-header split">
            <h2>Submit a New Job</h2>
            {queueLength !== null && (
              <p className="queue-length">
                <span className="queue-length-dot" aria-hidden="true" />
                {queueLength === 0
                  ? "No one in line"
                  : `${queueLength} ${queueLength === 1 ? "job" : "jobs"} in line`}
              </p>
            )}
          </div>
          <form className="card-body" onSubmit={handleSubmit}>
            {/* The API takes these from the sign-in token, not the form. */}
            <div className="field">
              <span className="field-label">Submitting as</span>
              <div className="submitter">
                <strong className="truncate">
                  {account.name ?? accountEmail(account)}
                </strong>
                <small className="truncate">{accountEmail(account)}</small>
              </div>
            </div>

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
                      {dragging ? (
                        "Drop your file to add it"
                      ) : (
                        <>
                          <span className="pointer-only">
                            Drag and drop your file here, or click to browse
                          </span>
                          <span className="touch-only">
                            Tap to choose a file
                          </span>
                        </>
                      )}
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

            <p className="help-text">
              Don't have Adobe Illustrator? Download it from{" "}
              <a
                href="https://luky.sharepoint.com/sites/downloads/SitePages/Adobe-Creative-Cloud.aspx"
                target="_blank"
                rel="noreferrer"
              >
                UK Downloads
              </a>
              .
            </p>
          </form>
        </section>
      )}
    </main>
  );
}
