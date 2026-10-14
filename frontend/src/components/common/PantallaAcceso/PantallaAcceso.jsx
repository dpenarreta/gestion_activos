import { useContext } from "react";

import { env } from "../../../config/env";
import { ThemeContext } from "../../../context/ThemeContext";
import { iniciales } from "../../../utils/iniciales";
import "./PantallaAcceso.css";

/**
 * La pantalla de quien todavía no ha entrado, con el dibujo de acceso de la
 * identidad base (`login-*`): a la izquierda el panel azul con la marca y para
 * qué sirve el sistema, a la derecha la tarjeta con el formulario.
 *
 * La comparten el acceso, la recuperación y el cambio de contraseña: son la
 * misma puerta, y que cada una tuviera su propio dibujo hacía pensar que se
 * había salido del sistema a mitad del trámite. En pantallas estrechas el panel
 * azul desaparece y queda solo la tarjeta.
 */
export function PantallaAcceso({ titulo, subtitulo, children }) {
  // Sin `useTheme`, que exige el proveedor: estas pantallas se dibujan también
  // antes de que el tema responda —o si no responde—, y entonces basta con el
  // nombre del arranque.
  const theme = useContext(ThemeContext)?.theme;
  const siteName = theme?.site_name || env.appName;

  return (
    <div className="login-screen">
      <aside className="login-aside">
        <div className="login-brand">
          {theme?.logo_url ? (
            <img src={theme.logo_url} alt="" className="login-logo" />
          ) : (
            <span className="login-glyph" aria-hidden="true">
              {iniciales(siteName)}
            </span>
          )}
          {siteName}
        </div>
        <div className="login-pitch">
          <h1>Cada equipo, su responsable y su historia en un solo lugar.</h1>
          <p>
            Registra los activos de cada empresa, asigna custodios, programa
            mantenimientos y recibe a tiempo las alertas de renovación.
          </p>
        </div>
        <div className="login-foot">
          Inventario · Mantenimientos · Solicitudes · Reportes
        </div>
      </aside>
      <main className="login-main">
        <div className="login-card">
          <h2>{titulo}</h2>
          {subtitulo && <p className="login-sub">{subtitulo}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
