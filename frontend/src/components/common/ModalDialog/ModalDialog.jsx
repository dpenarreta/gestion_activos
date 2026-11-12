import { useId } from "react";

import { useModalA11y } from "../../../hooks/useModalA11y";
import { Icon } from "../Icon/Icon";
import "./ModalDialog.css";

/**
 * Envoltorio de diálogo para los formularios modales del dominio.
 *
 * `ConfirmDialog` ya resuelve el caso "pregunta y dos botones", pero no
 * admite contenido arbitrario ni un `<form>` propio. En vez de forzarlo a
 * hacer ambas cosas, este componente reutiliza el mismo `useModalA11y` (foco
 * atrapado, Escape, bloqueo de scroll, retorno de foco) y deja el cuerpo y el
 * pie abiertos.
 *
 * El contenido va dentro de un `<form>`: los tres diálogos del módulo envían
 * datos, y así el Enter en un campo confirma, que es lo que espera quien
 * captura con teclado.
 */
export function ModalDialog({
  titulo,
  subtitulo,
  children,
  onCerrar,
  onSubmit,
  textoConfirmar = "Confirmar",
  isSaving = false,
  puedeConfirmar = true,
  variante = "primary",
  anchoMaximo,
  // El nombre accesible de la X (por defecto, «Cerrar» como hasta ahora).
  etiquetaCerrar = "Cerrar",
  // Sin la burbuja del navegador: el formulario valida y pone su error junto
  // al campo (Órdenes, US-006, 11/11/2026). Por defecto, como hasta ahora.
  noValidate = false,
  // Lo que dice el botón mientras se envía.
  textoGuardando = "Guardando…",
  // El botón que cierra sin enviar («Volver» en las acciones destructivas).
  textoCancelar = "Cancelar",
  // Sin nada que perder (p. ej. el formulario ya se quitó): la X y el pie
  // cierran sin preguntar «¿Descartar?».
  sinPreguntarAlDescartar = false,
}) {
  // Un id por ventana: con un id fijo, dos ventanas anidadas compartían
  // «modal-dialog-titulo» y la de dentro se anunciaba con el título de la de
  // fuera (auditoría UX/UI, fase 3, 28/10/2026).
  const idTitulo = `${useId()}-titulo`;
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
    // Mientras se envía no se cierra (ni con Escape): se perdería el
    // resultado de lo que ya salió al servidor.
    guardClose: isSaving ? () => false : undefined,
  });

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal"
        style={anchoMaximo ? { width: `min(${anchoMaximo}, 94vw)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        ref={panelRef}
        tabIndex={-1}
      >
        <form
          onSubmit={onSubmit}
          className="mz-modal-form"
          noValidate={noValidate || undefined}
          data-no-descarta={sinPreguntarAlDescartar || undefined}
        >
          <div className="mz-panel-head">
            <div>
              <h3 id={idTitulo}>{titulo}</h3>
              {subtitulo && <p className="mz-desc">{subtitulo}</p>}
            </div>
            <button
              type="button"
              className="mz-close"
              onClick={onCerrar}
              disabled={isSaving}
              aria-label={etiquetaCerrar}
            >
              <Icon name="x-lg" />
            </button>
          </div>

          <div className="mz-panel-body">{children}</div>

          <div className="mz-panel-foot">
            <button
              type="button"
              className="btn btn-cancelar"
              onClick={onCerrar}
              disabled={isSaving}
            >
              {textoCancelar}
            </button>
            {onSubmit && (
              <button
                type="submit"
                className={`btn btn-${variante}`}
                disabled={isSaving || !puedeConfirmar}
              >
                {isSaving ? textoGuardando : textoConfirmar}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
