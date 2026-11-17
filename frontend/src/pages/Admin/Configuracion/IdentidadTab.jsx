import { useState } from "react";

import { DevicePreviewFrame } from "../../../components/common/DevicePreviewFrame/DevicePreviewFrame";
import "./IdentidadTab.css";

/**
 * Componente de presentación puro: no tiene estado propio ni llama a la
 * API — recibe `form`/`updateField` de `ConfiguracionPage`. El logo/favicon
 * se ingresan como URL de texto (propia o externa): esta base no
 * incluye un pipeline de carga de archivos, para mantenerse desacoplado de
 * cualquier biblioteca de medios.
 */
/** Los textos de la pantalla de acceso, con su largo máximo (el mismo del
 * servidor, `branding/catalog.py`). */
const TEXTOS_ACCESO = [
  {
    campo: "acceso_lema",
    etiqueta: "Lema",
    ayuda: "El título grande del panel de la izquierda.",
    largo: 120,
    obligatorio: true,
  },
  {
    campo: "acceso_descripcion",
    etiqueta: "Descripción",
    ayuda: "Para qué sirve el sistema, bajo el lema. Vacío, no se muestra.",
    largo: 400,
    multilinea: true,
  },
  {
    campo: "acceso_pie",
    etiqueta: "Pie del panel",
    ayuda: "La línea de abajo del panel. Vacío, no se muestra.",
    largo: 160,
  },
  {
    campo: "acceso_titulo",
    etiqueta: "Título del formulario",
    ayuda: "Encima del usuario y la contraseña.",
    largo: 80,
    obligatorio: true,
  },
  {
    campo: "acceso_subtitulo",
    etiqueta: "Frase bajo el título",
    ayuda: "Vacío, no se muestra.",
    largo: 160,
  },
];

export function IdentidadTab({ form, updateField }) {
  const [device, setDevice] = useState("desktop");

  return (
    <div className="identidad-tab mz-grid-2 mz-grid-2--even">
      <section className="mz-card">
        <div className="mz-card-head">
          <h3>Nombre e imagen</h3>
        </div>
        <div className="mz-card-body">
          <div className="mz-field-grid">
            <div className="mz-field mz-field--full">
              <label htmlFor="site_name">Nombre del sitio</label>
              <input
                id="site_name"
                className="form-control"
                value={form.site_name}
                onChange={(event) =>
                  updateField("site_name", event.target.value)
                }
                required
              />
            </div>
            <div className="mz-field">
              <label htmlFor="short_name">Nombre corto</label>
              <input
                id="short_name"
                className="form-control"
                value={form.short_name}
                onChange={(event) =>
                  updateField("short_name", event.target.value)
                }
              />
            </div>
            <div className="mz-field mz-field--full">
              <label htmlFor="logo_url">Logo (URL)</label>
              <input
                id="logo_url"
                className="form-control"
                value={form.logo_url}
                onChange={(event) =>
                  updateField("logo_url", event.target.value)
                }
              />
            </div>
            <div className="mz-field mz-field--full">
              <label htmlFor="favicon_url">Favicon (URL)</label>
              <input
                id="favicon_url"
                className="form-control"
                value={form.favicon_url}
                onChange={(event) =>
                  updateField("favicon_url", event.target.value)
                }
              />
            </div>
          </div>
        </div>
      </section>

      <section className="mz-card">
        <div className="mz-card-head">
          <h3>Pantalla de acceso</h3>
        </div>
        <div className="mz-card-body">
          {/* Lo que se ve antes de entrar (17/11/2026). Debajo del logo va el
              «Nombre del sitio». */}
          <p className="mz-small mz-faint">
            Los textos de la pantalla de inicio de sesión. Debajo del logo se
            muestra el «Nombre del sitio».
          </p>
          <div className="mz-field-grid">
            {TEXTOS_ACCESO.map((texto) => {
              const valor = form[texto.campo] ?? "";
              const Control = texto.multilinea ? "textarea" : "input";
              return (
                <div key={texto.campo} className="mz-field mz-field--full">
                  <label htmlFor={texto.campo}>{texto.etiqueta}</label>
                  <Control
                    id={texto.campo}
                    className="form-control"
                    value={valor}
                    maxLength={texto.largo}
                    rows={texto.multilinea ? 3 : undefined}
                    required={texto.obligatorio}
                    aria-describedby={`${texto.campo}-ayuda`}
                    onChange={(event) =>
                      updateField(texto.campo, event.target.value)
                    }
                  />
                  <div id={`${texto.campo}-ayuda`} className="form-text">
                    {texto.ayuda} {valor.length}/{texto.largo}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mz-card">
        <div className="mz-card-head">
          <h3>Vista previa</h3>
        </div>
        <div className="mz-card-body">
          {/* Lo de dentro del marco muestra el tema elegido —el color del
              menú, el logo—, no la identidad de esta pantalla. */}
          <DevicePreviewFrame device={device} onDeviceChange={setDevice}>
            <div className="identidad-tab__preview-browser-bar">
              {form.favicon_url ? (
                <img
                  className="identidad-tab__preview-favicon"
                  src={form.favicon_url}
                  alt="Favicon"
                />
              ) : (
                <span className="identidad-tab__preview-favicon" />
              )}
              <span className="identidad-tab__preview-tab-label">
                {form.site_name || "Nombre del sitio"}
              </span>
            </div>
            <div className="identidad-tab__preview-menu">
              {form.logo_url ? (
                <img
                  className="identidad-tab__preview-logo"
                  src={form.logo_url}
                  alt="Logo"
                />
              ) : (
                <span className="identidad-tab__preview-sin-logo">
                  Sin logo
                </span>
              )}
            </div>
            <div className="identidad-tab__preview-body">
              Contenido de ejemplo de la página
            </div>
          </DevicePreviewFrame>
        </div>
      </section>
    </div>
  );
}
