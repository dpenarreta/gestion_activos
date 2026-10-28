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
}) {
  // Un id por ventana: con un id fijo, dos ventanas anidadas compartían
  // «modal-dialog-titulo» y la de dentro se anunciaba con el título de la de
  // fuera (auditoría UX/UI, fase 3, 28/10/2026).
  const idTitulo = `${useId()}-titulo`;
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
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
        <form onSubmit={onSubmit} className="mz-modal-form">
          <div className="mz-panel-head">
            <div>
              <h3 id={idTitulo}>{titulo}</h3>
              {subtitulo && <p className="mz-desc">{subtitulo}</p>}
            </div>
            <button
              type="button"
              className="mz-close"
              onClick={onCerrar}
              aria-label="Cerrar"
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
            >
              Cancelar
            </button>
            {onSubmit && (
              <button
                type="submit"
                className={`btn btn-${variante}`}
                disabled={isSaving || !puedeConfirmar}
              >
                {isSaving ? "Guardando…" : textoConfirmar}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
