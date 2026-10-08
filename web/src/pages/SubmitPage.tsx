import type { FormEvent } from "react";
import { ALLOWED_EXTENSIONS } from "../api";

const ACCEPT = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export function SubmitPage() {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // TODO (Milestone 2): createJob() -> uploadFile() -> show success state.
  }

  return (
    <main>
      <h1>Submit a Laser Cut Job</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Name
          <input name="studentName" required />
        </label>
        <label>
          Student email
          <input name="studentEmail" type="email" required />
        </label>
        <label>
          File ({ACCEPT})
          <input name="file" type="file" accept={ACCEPT} required />
        </label>
        <button type="submit">Submit</button>
      </form>
    </main>
  );
}
