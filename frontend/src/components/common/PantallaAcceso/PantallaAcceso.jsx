import { useContext } from "react";

import { env } from "../../../config/env";
import { ThemeContext } from "../../../context/ThemeContext";
import { LogoMarca } from "../Marca/Marca";
import "./PantallaAcceso.css";

/**
 * La pantalla de quien todavía no ha entrado, con el dibujo de acceso de la
 * identidad base (`login-*`): a la izquierda el panel carbón con la marca
 * LAARCOURIER y para qué sirve el sistema, a la derecha la tarjeta con el
 * formulario.
 *
 * La comparten el acceso, la recuperación y el cambio de contraseña: son la
 * misma puerta, y que cada una tuviera su propio dibujo hacía pensar que se
 * había salido del sistema a mitad del trámite. En pantallas estrechas el panel
 * desaparece y el logotipo pasa a la tarjeta.
 */
/** Los textos por defecto, iguales a los del servidor (`branding/catalog.py`):
 * se usan antes de que el tema responda, o si no responde. */
export const TEXTOS_ACCESO_POR_DEFECTO = {
  acceso_lema: "Entregamos seguridad y confianza.",
  acceso_descripcion:
    "La intranet del grupo: los equipos y su mantenimiento, la mesa de ayuda, la gestión humana y la vida institucional de cada empresa, en un solo lugar.",
  acceso_pie: "Activos · Mesa de ayuda · Gestión Humana · Institucional",
  acceso_titulo: "Acceso al sistema",
  acceso_subtitulo: "Ingrese con su usuario corporativo.",
};

/** Un texto de la pantalla de acceso: el del tema (personalizable en
 * Configuración › Identidad, 17/11/2026) o el de siempre. Un texto vaciado a
 * propósito se respeta (no se muestra). */
export function textoDeAcceso(theme, campo) {
  const valor = theme?.[campo];
  return typeof valor === "string" ? valor : TEXTOS_ACCESO_POR_DEFECTO[campo];
}

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
            <>
              <img src={theme.logo_url} alt="" className="login-logo" />
              {siteName}
            </>
          ) : (
            <span className="login-brand-marca">
              <LogoMarca version="negativo" />
              <span className="login-brand-nombre">{siteName}</span>
            </span>
          )}
        </div>
        <div className="login-pitch">
          {/* El lema de la marca (Brand Book 2026); los textos se cambian en
              Configuración › Identidad. */}
          <h1>{textoDeAcceso(theme, "acceso_lema")}</h1>
          {textoDeAcceso(theme, "acceso_descripcion") && (
            <p>{textoDeAcceso(theme, "acceso_descripcion")}</p>
          )}
        </div>
        {textoDeAcceso(theme, "acceso_pie") && (
          <div className="login-foot">{textoDeAcceso(theme, "acceso_pie")}</div>
        )}
      </aside>
      <main className="login-main">
        <div className="login-card">
          {!theme?.logo_url && (
            // Sin el panel (pantallas estrechas), la marca va en la tarjeta;
            // `marca.css` elige la versión según el tema.
            <div className="login-card-marca">
              <LogoMarca version="positivo" />
              <LogoMarca version="negativo" />
            </div>
          )}
          <h2>{titulo}</h2>
          {subtitulo && <p className="login-sub">{subtitulo}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
