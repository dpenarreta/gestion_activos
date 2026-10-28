import { Children, cloneElement, isValidElement } from "react";

/*
 * Un campo de formulario con su etiqueta, la marca de obligatorio, su ayuda y
 * su error, todos asociados al control (auditoría UX/UI de todo el sistema,
 * fase 2, 28/10/2026: los obligatorios no se marcaban y el error del servidor
 * aparecía arriba, lejos del campo y sin decir cuál era).
 *
 *     <Campo id="activo-serie" etiqueta="Serie" obligatorio error={errores.serie}>
 *       <input className="form-control" value={serie} onChange={…} />
 *     </Campo>
 *
 * Al control (el único hijo) le pone id, `aria-required`, `aria-invalid`,
 * `is-invalid` y `aria-describedby` hacia la ayuda y el error. No pone
 * `required`: la burbuja del navegador taparía el error propio del campo y
 * se vería distinta en cada formulario (auditoría UX/UI, fase 2); lo valida
 * el servidor y su error llega bajo el campo.
 */
export function Campo({
  id,
  etiqueta,
  obligatorio = false,
  ayuda,
  error,
  className = "",
  children,
}) {
  const idAyuda = ayuda ? `${id}-ayuda` : null;
  const idError = error ? `${id}-error` : null;
  const control = Children.only(children);
  const describe = [control.props["aria-describedby"], idAyuda, idError]
    .filter(Boolean)
    .join(" ");
  const conAtributos = isValidElement(control)
    ? cloneElement(control, {
        id,
        "aria-required": obligatorio || control.props.required || undefined,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describe || undefined,
        className:
          [control.props.className, error && "is-invalid"]
            .filter(Boolean)
            .join(" ") || undefined,
      })
    : control;
  return (
    <div className={`mz-campo ${className}`.trim()}>
      <label className="form-label" htmlFor={id}>
        {etiqueta}
        {obligatorio && (
          <>
            <span className="mz-campo__obligatorio" aria-hidden="true">
              {" "}
              *
            </span>
            <span className="visually-hidden"> (obligatorio)</span>
          </>
        )}
      </label>
      {conAtributos}
      {ayuda && (
        <div id={idAyuda} className="form-text">
          {ayuda}
        </div>
      )}
      {error && (
        <div id={idError} className="mz-field-error">
          {error}
        </div>
      )}
    </div>
  );
}

/** Leyenda para un formulario con obligatorios: «* Obligatorio». */
export function LeyendaObligatorios() {
  return (
    <p className="mz-small mz-faint mb-0">
      <span className="mz-campo__obligatorio" aria-hidden="true">
        *
      </span>{" "}
      Obligatorio
    </p>
  );
}

/**
 * Después de un error al enviar: el foco va al primer campo inválido o, si no
 * hay, al aviso de error del formulario, para que se vea qué corregir.
 */
export function enfocarPrimerError(contenedor) {
  if (!contenedor) return;
  // Tras pintar los errores.
  requestAnimationFrame(() => {
    const destino =
      contenedor.querySelector('[aria-invalid="true"]') ??
      contenedor.querySelector('[role="alert"]');
    if (!destino) return;
    if (!destino.matches("input, select, textarea, button, [tabindex]")) {
      destino.setAttribute("tabindex", "-1");
    }
    destino.focus();
  });
}
