import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "@fontsource/sora/500.css";
import "@fontsource/sora/600.css";
import "@fontsource/sora/700.css";
import "@fontsource/sora/800.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./styles/brand.css";
import "./styles/variables.css";
import "./styles/appearance-tokens.css";
import "./styles/breakpoints.css";
import "./styles/global.css";
// La identidad base va después de global.css y el puente al final: cada capa
// gana a la anterior por orden (ver scripts/sincronizar-identidad.sh).
import "./styles/identidad-base.css";
import "./styles/identidad-puente.css";

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
