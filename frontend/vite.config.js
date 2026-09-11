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
      // Las de extremo a extremo son de Playwright y necesitan un navegador y
      // los servidores levantados: se ejecutan con `npm run e2e`. Sin esta
      // línea, Vitest las recoge y falla al no encontrar su propio arranque.
      exclude: ["node_modules/**", "e2e/**"],
      coverage: {
        // Sin esto solo se cuentan los archivos que alguna prueba importa, y
        // una pantalla sin ninguna prueba no baja el porcentaje: el número
        // sube al abandonar un módulo. Con `include` cuenta todo `src/`, que
        // es lo que se quiere saber.
        include: ["src/**"],
        exclude: ["src/**/*.css", "src/main.jsx"],
      },
      env: {
        VITE_APP_NAME: "Gestión de Activos",
        VITE_API_BASE_URL: "http://localhost:8000/api/v1",
      },
    },
  };
});
