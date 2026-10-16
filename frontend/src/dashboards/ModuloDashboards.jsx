import { useEffect } from "react";

import "./styles/dashboard.css";
import "./styles/directorio.css";
import "./styles/identidad-dashboards.css";

/**
 * Raíz de las pantallas del módulo de Dashboards.
 *
 * El módulo se portó desde `cms_dashboards` conservando sus pantallas y sus
 * estilos. Esos estilos están acotados a `.modulo-dashboards` (ver
 * `styles/dashboard.css`): fuera de esta raíz el resto del sistema se ve como
 * siempre. Los modales y paneles laterales de react-bootstrap se montan fuera,
 * en un portal; sus reglas no se acotan porque el sistema no los usa.
 *
 * La paleta de componentes del editor se coloca justo debajo de la barra
 * superior y para eso necesita su alto (`--mz-topbar-h`). En el sistema de
 * origen era fijo; aquí se mide, porque la barra del sistema cambia de alto
 * según el ancho de la pantalla.
 */
export function ModuloDashboards({ children }) {
  useEffect(() => {
    const barra = document.querySelector(".mz-topbar");
    if (!barra) return undefined;
    const raiz = document.documentElement;
    const medir = () =>
      raiz.style.setProperty("--mz-topbar-h", `${barra.offsetHeight}px`);
    medir();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observador = new ResizeObserver(medir);
    observador.observe(barra);
    return () => observador.disconnect();
  }, []);

  return <div className="modulo-dashboards">{children}</div>;
}
