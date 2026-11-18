import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // http://localhost:5173 is the only local redirect URI registered for
  // Entra sign-in, so fail instead of silently moving to another port.
  server: { port: 5173, strictPort: true },
});
