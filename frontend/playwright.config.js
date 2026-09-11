import { defineConfig, devices } from "@playwright/test";

/**
 * Pruebas de extremo a extremo: el navegador de verdad contra el sistema de
 * verdad.
 *
 * Es la capa que las otras tres no cubren. Las de Vitest montan componentes con
 * la capa de servicios simulada y las de pytest llegan hasta la API: entre las
 * dos queda un hueco —el CSS, el árbol montado completo, la sesión que viaja
 * entre pantallas, el backend real respondiendo— y es justo donde aparecieron
 * los tres defectos que hubo que encontrar a mano (ver
 * `tests/qa/test-execution-report.md`).
 *
 * No levanta los servidores: usa los que ya están corriendo (backend en 8010,
 * frontend en 5174). Arrancarlos desde aquí se llevaría por delante los del
 * entorno de trabajo, que es donde se está mirando la aplicación mientras se
 * programa.
 */
export default defineConfig({
  testDir: "./e2e",
  // Uno detrás de otro: comparten una base de datos real, y dos navegadores
  // creando activos a la vez harían que un listado contara lo del otro.
  workers: 1,
  fullyParallel: false,
  // En local conviene ver el fallo y arreglarlo; en CI, descartar la
  // intermitencia de una espera antes de dar por roto el sistema.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./e2e/apoyo/preparar.js",
  globalTeardown: "./e2e/apoyo/limpiar.js",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:5174",
    storageState: "./e2e/.auth/sesion.json",
    // Solo de lo que falla: una traza por prueba llena el disco y ninguna se
    // mira cuando todo está en verde.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    locale: "es-EC",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
