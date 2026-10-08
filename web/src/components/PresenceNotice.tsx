import { AlertIcon } from "../icons";

export function PresenceNotice() {
  return (
    <p className="notice info" role="note">
      <AlertIcon />
      <span>
        <strong>You must be present</strong> to submit to the queue and to have
        your job cut on the laser.
      </span>
    </p>
  );
}
