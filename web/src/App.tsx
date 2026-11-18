import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { isStaff } from "./auth";
import { AuthGate, useAccount } from "./components/AuthGate";
import { InboxIcon } from "./icons";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { QueuePage } from "./pages/QueuePage";
import { SubmitPage } from "./pages/SubmitPage";

/**
 * Hides staff pages from students. This is only for a friendlier message: the
 * API rejects non-staff requests on its own.
 */
function StaffOnly({ children }: { children: ReactNode }) {
  const account = useAccount();
  if (isStaff(account)) return children;
  return (
    <main>
      <section className="card empty-state">
        <InboxIcon />
        <h2>Staff only</h2>
        <p>
          This page is for Innovation Center staff. If you were just given
          access, sign out and back in.
        </p>
        <Link className="button" to="/submit">
          Submit a job
        </Link>
      </section>
    </main>
  );
}

export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route path="/submit" element={<SubmitPage />} />
        <Route
          path="/queue"
          element={
            <StaffOnly>
              <QueuePage />
            </StaffOnly>
          }
        />
        <Route
          path="/analytics"
          element={
            <StaffOnly>
              <AnalyticsPage />
            </StaffOnly>
          }
        />
        <Route path="*" element={<Navigate to="/submit" replace />} />
      </Routes>
    </AuthGate>
  );
}
