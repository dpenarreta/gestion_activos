import { useId } from "react";

import { FontPreviewOption } from "./FontPreviewOption";
import "./TypographySelector.css";

/** Selector de fuente (principal o secundaria) del catálogo estático de
 * `apps.branding.catalog.FONT_FAMILIES` (ver `ThemeOptionsView`). */
export function TypographySelector({ label, fonts, value, onChange }) {
  const selectId = useId();
  const selected = fonts.find((font) => font.key === value);

  return (
    <div className="typography-selector">
      <label className="form-label" htmlFor={selectId}>
        {label}
      </label>
      <select
        id={selectId}
        className="form-select"
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
      >
        {fonts.map((font) => (
          <option key={font.key} value={font.key} style={{ fontFamily: font.css_stack }}>
            {font.label}
          </option>
        ))}
      </select>

      {selected && <FontPreviewOption font={selected} />}
    </div>
  );
}
