import { useModalA11y } from "../../../hooks/useModalA11y";
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
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });

  return (
    <div className="modal-dialog-custom__backdrop" onClick={handleBackdropClick} role="presentation">
      <div
        className="modal-dialog-custom__panel"
        style={anchoMaximo ? { maxWidth: anchoMaximo } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-dialog-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <form onSubmit={onSubmit}>
          <div className="modal-dialog-custom__header">
            <h2 className="h5 mb-0" id="modal-dialog-titulo">
              {titulo}
            </h2>
            {subtitulo && <p className="text-muted small mb-0 mt-1">{subtitulo}</p>}
          </div>

          <div className="modal-dialog-custom__body">{children}</div>

          <div className="modal-dialog-custom__footer">
            <button type="button" className="btn btn-outline-secondary" onClick={onCerrar}>
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
