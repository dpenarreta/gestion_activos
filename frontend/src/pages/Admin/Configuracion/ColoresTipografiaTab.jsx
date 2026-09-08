import { useState } from "react";

import { DevicePreviewFrame } from "../../../components/common/DevicePreviewFrame/DevicePreviewFrame";
import { TypographySelector } from "../../../components/typography/TypographySelector";
import { isValidHexColor } from "../../../utils/colorContrast";
import "./ColoresTipografiaTab.css";

const DEMO_TEXT = "Veloz murciélago hindú comía feliz cardillo y kiwi.";

export const COLOR_FIELDS = [
  { key: "color_primary", label: "Color primario" },
  { key: "color_secondary", label: "Color secundario" },
  { key: "color_background", label: "Color de fondo" },
  { key: "color_headings", label: "Color de encabezados" },
  { key: "color_text", label: "Color de texto principal" },
  { key: "color_links", label: "Color de enlaces" },
  { key: "color_buttons", label: "Color de botones" },
  { key: "color_menu", label: "Color del menú" },
];

function ColorField({ id, label, value, onChange }) {
  const valid = isValidHexColor(value);
  return (
    <div className="mb-3 colores-tab__color-field">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <div className="d-flex align-items-center gap-2">
        <input
          type="color"
          className="form-control form-control-color"
          id={id}
          value={valid ? value : "#000000"}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`Paleta de color para ${label}`}
        />
        <input
          type="text"
          className={`form-control ${valid ? "" : "is-invalid"}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#0D6EFD"
        />
      </div>
      {!valid && <div className="invalid-feedback d-block">Formato hexadecimal inválido.</div>}
    </div>
  );
}

/**
 * Componente de presentación puro (mismo contrato que IdentidadTab): recibe
 * `form`/`updateField`/`options` (catálogo de fuentes y radios de borde) de
 * `ConfiguracionPage`. Incluye la vista previa en vivo.
 */
export function ColoresTipografiaTab({ form, updateField, options }) {
  const [previewDevice, setPreviewDevice] = useState("desktop");
  const previewStyle = {
    "--color-primary": form.color_primary,
    "--color-secondary": form.color_secondary,
    "--color-background": form.color_background,
    "--color-headings": form.color_headings,
    "--color-text": form.color_text,
    "--color-links": form.color_links,
    "--color-buttons": form.color_buttons,
    "--color-menu": form.color_menu,
    "--font-primary": options.fonts.find((font) => font.key === form.font_primary)?.css_stack,
    "--font-secondary": options.fonts.find((font) => font.key === form.font_secondary)?.css_stack,
    "--font-size-base": `${form.font_size_base}px`,
    "--border-radius": options.border_radii[form.border_radius]?.value,
  };

  return (
    <div className="colores-tab row">
      <div className="col-12 col-lg-6">
        <h5>Colores</h5>
        {COLOR_FIELDS.map((field) => (
          <ColorField
            key={field.key}
            id={field.key}
            label={field.label}
            value={form[field.key]}
            onChange={(value) => updateField(field.key, value)}
          />
        ))}

        <h5>Tipografía</h5>
        <div className="mb-3">
          <TypographySelector
            label="Fuente principal"
            fonts={options.fonts}
            value={form.font_primary}
            onChange={(fontKey) => updateField("font_primary", fontKey)}
          />
        </div>
        <div className="mb-3">
          <TypographySelector
            label="Fuente secundaria (encabezados)"
            fonts={options.fonts}
            value={form.font_secondary}
            onChange={(fontKey) => updateField("font_secondary", fontKey)}
          />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="font_size_base">
            Tamaño base de fuente (px)
          </label>
          <input
            id="font_size_base"
            type="number"
            min="12"
            max="24"
            className="form-control"
            value={form.font_size_base}
            onChange={(event) => updateField("font_size_base", event.target.value)}
          />
        </div>

        <h5>Bordes</h5>
        <div className="mb-4">
          <label className="form-label" htmlFor="border_radius">
            Radio de bordes
          </label>
          <select
            id="border_radius"
            className="form-select"
            value={form.border_radius}
            onChange={(event) => updateField("border_radius", event.target.value)}
          >
            {Object.entries(options.border_radii).map(([slug, radius]) => (
              <option key={slug} value={slug}>
                {radius.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="col-12 col-lg-6">
        <h5>Vista previa</h5>
        <DevicePreviewFrame device={previewDevice} onDeviceChange={setPreviewDevice}>
          <div className="colores-tab__preview" style={previewStyle}>
            <div className="colores-tab__preview-menu">{form.site_name || "Nombre del sitio"}</div>
            <div className="colores-tab__preview-body">
              <h3>Encabezado de ejemplo</h3>
              <p>{DEMO_TEXT}</p>
              <p>
                Este es un párrafo de demostración con un <a href="#preview">enlace de ejemplo</a> para
                mostrar el color configurado.
              </p>
              <div className="mb-3">
                <label className="form-label" htmlFor="preview-input">
                  Campo de formulario de ejemplo
                </label>
                <input id="preview-input" className="form-control" readOnly value={DEMO_TEXT} />
              </div>
              <div className="d-flex flex-wrap gap-2">
                <button type="button" className="btn app-button app-button--primary">
                  Botón primario
                </button>
                <button type="button" className="btn app-button app-button--secondary">
                  Botón secundario
                </button>
              </div>
            </div>
          </div>
        </DevicePreviewFrame>
      </div>
    </div>
  );
}
