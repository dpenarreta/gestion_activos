import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      port: Number(env.VITE_PORT) || 5173,
    },
    test: {
      environment: "jsdom",
      setupFiles: "./tests/setup.js",
      globals: true,
      env: {
        VITE_APP_NAME: "Gestión de Activos",
        VITE_API_BASE_URL: "http://localhost:8000/api/v1",
      },
    },
  };
});
