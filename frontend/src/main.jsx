import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./styles/brand.css";
import "./styles/variables.css";
import "./styles/appearance-tokens.css";
import "./styles/breakpoints.css";
import "./styles/global.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { env } from "./config/env";
import { registrarServiceWorker } from "./pwa/registrarServiceWorker";

document.title = env.appName;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Después de montar: registrar el service worker compite por el hilo con el
// primer dibujado, y lo que esto habilita —instalarla en el teléfono— no hace
// falta en el primer segundo.
registrarServiceWorker();
