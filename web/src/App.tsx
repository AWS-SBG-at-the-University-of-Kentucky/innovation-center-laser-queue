import { Navigate, Route, Routes } from "react-router-dom";
import { QueuePage } from "./pages/QueuePage";
import { SubmitPage } from "./pages/SubmitPage";

export function App() {
  return (
    <Routes>
      <Route path="/submit" element={<SubmitPage />} />
      <Route path="/queue" element={<QueuePage />} />
      <Route path="*" element={<Navigate to="/submit" replace />} />
    </Routes>
  );
}
