import { useState } from "react";

import { DevicePreviewFrame } from "../../../components/common/DevicePreviewFrame/DevicePreviewFrame";
import "./IdentidadTab.css";

/**
 * Componente de presentación puro: no tiene estado propio ni llama a la
 * API — recibe `form`/`updateField` de `ConfiguracionPage`. El logo/favicon
 * se ingresan como URL de texto (propia o externa): este template base no
 * incluye un pipeline de carga de archivos, para mantenerse desacoplado de
 * cualquier biblioteca de medios.
 */
export function IdentidadTab({ form, updateField }) {
  const [device, setDevice] = useState("desktop");

  return (
    <div className="identidad-tab">
      <div className="mb-3">
        <label className="form-label" htmlFor="site_name">
          Nombre del sitio
        </label>
        <input
          id="site_name"
          className="form-control"
          value={form.site_name}
          onChange={(event) => updateField("site_name", event.target.value)}
          required
        />
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="short_name">
          Nombre corto
        </label>
        <input
          id="short_name"
          className="form-control"
          value={form.short_name}
          onChange={(event) => updateField("short_name", event.target.value)}
        />
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="logo_url">
          Logo (URL)
        </label>
        <input
          id="logo_url"
          className="form-control"
          value={form.logo_url}
          onChange={(event) => updateField("logo_url", event.target.value)}
        />
      </div>
      <div className="mb-3">
        <label className="form-label" htmlFor="favicon_url">
          Favicon (URL)
        </label>
        <input
          id="favicon_url"
          className="form-control"
          value={form.favicon_url}
          onChange={(event) => updateField("favicon_url", event.target.value)}
        />
      </div>

      <h5>Vista previa</h5>
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
            <img className="identidad-tab__preview-logo" src={form.logo_url} alt="Logo" />
          ) : (
            <span className="text-white small">Sin logo</span>
          )}
        </div>
        <div className="identidad-tab__preview-body">Contenido de ejemplo de la página</div>
      </DevicePreviewFrame>
    </div>
  );
}
