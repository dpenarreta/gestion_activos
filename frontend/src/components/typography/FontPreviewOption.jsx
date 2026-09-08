const DEMO_TEXT = "La rápida navegación del sitio debe mantenerse clara, legible y consistente.";

/** Demostración en vivo de una fuente del catálogo estático, renderizada
 * con su propio `css_stack`. */
export function FontPreviewOption({ font }) {
  return (
    <div className="font-preview-option">
      <span className="font-preview-option__label">{font.label}</span>
      <p className="font-preview-option__demo mb-0" style={{ fontFamily: font.css_stack }}>
        {DEMO_TEXT}
      </p>
    </div>
  );
}
