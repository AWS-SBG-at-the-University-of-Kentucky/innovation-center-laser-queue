import { type FormEvent, useState } from "react";
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  createJob,
  uploadFile,
} from "../api";

const ACCEPT = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(",");
const MAX_FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / (1024 * 1024);

type Status =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "success"; fileName: string }
  | { state: "error"; message: string };

function checkFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((allowed) => allowed === ext)) {
    return `File must be one of: ${ACCEPT.replaceAll(",", ", ")}.`;
  }
  if (file.size === 0) return "The file is empty.";
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File must be ${MAX_FILE_SIZE_MB} MB or smaller.`;
  }
  return null;
}

export function SubmitPage() {
  const [status, setStatus] = useState<Status>({ state: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File)) return;

    const fileError = checkFile(file);
    if (fileError) {
      setStatus({ state: "error", message: fileError });
      return;
    }

    setStatus({ state: "submitting" });
    try {
      const { uploadUrl } = await createJob({
        studentName: String(data.get("studentName")),
        studentEmail: String(data.get("studentEmail")),
        fileName: file.name,
        fileSize: file.size,
      });
      await uploadFile(uploadUrl, file);
      form.reset();
      setStatus({ state: "success", fileName: file.name });
    } catch (err) {
      setStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  }

  if (status.state === "success") {
    return (
      <main>
        <h1>Job submitted</h1>
        <p className="notice success" role="status">
          <strong>{status.fileName}</strong> is in the laser queue. Innovation
          Center staff will cut it in the order it was received.
        </p>
        <button type="button" onClick={() => setStatus({ state: "idle" })}>
          Submit another file
        </button>
      </main>
    );
  }

  const submitting = status.state === "submitting";

  return (
    <main>
      <h1>Submit a Laser Cut Job</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Name
          <input name="studentName" maxLength={100} required />
        </label>
        <label>
          Student email
          <input name="studentEmail" type="email" required />
        </label>
        <label>
          File ({ACCEPT.replaceAll(",", ", ")} — up to {MAX_FILE_SIZE_MB} MB)
          <input name="file" type="file" accept={ACCEPT} required />
        </label>
        {status.state === "error" && (
          <p className="notice error" role="alert">
            {status.message}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? "Uploading…" : "Submit"}
        </button>
      </form>
    </main>
  );
}
