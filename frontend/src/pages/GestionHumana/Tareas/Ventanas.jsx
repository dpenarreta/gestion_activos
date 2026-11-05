/*
 * Ventana y panel lateral de Tareas. `ModalDialog` resuelve el formulario con
 * un solo envío; aquí hacen falta ventanas con varias acciones (la validación
 * de Tiempo Objetivo y de Fecha Fin, cada una con su propio envío) y paneles
 * laterales con una lista y un formulario (actividades, comentarios). Usan el
 * mismo `useModalA11y`: foco atrapado, Escape, bloqueo del desplazamiento,
 * retorno del foco y aviso antes de descartar lo escrito.
 */
import { useId } from "react";

import { Icon } from "../../../components/common/Icon/Icon";
import { useModalA11y } from "../../../hooks/useModalA11y";

function Cabecera({ idTitulo, titulo, subtitulo, onCerrar }) {
  return (
    <div className="mz-panel-head">
      <div className="gt-min0">
        <h3 id={idTitulo} className="gt-titulo-panel">
          {titulo}
        </h3>
        {subtitulo && <p className="mz-desc mb-0">{subtitulo}</p>}
      </div>
      <button
        type="button"
        className="mz-close"
        aria-label="Cerrar ventana"
        onClick={onCerrar}
      >
        <Icon name="x-lg" />
      </button>
    </div>
  );
}

/** Ventana centrada con cuerpo y pie libres. */
export function Ventana({
  titulo,
  subtitulo,
  onCerrar,
  pie,
  ancha = false,
  children,
}) {
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
        className={`mz-modal${ancha ? " mz-modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        ref={panelRef}
        tabIndex={-1}
      >
        <Cabecera
          idTitulo={idTitulo}
          titulo={titulo}
          subtitulo={subtitulo}
          onCerrar={onCerrar}
        />
        <div className="mz-panel-body">{children}</div>
        <div className="mz-panel-foot">
          {pie ?? (
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={onCerrar}
            >
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Panel lateral (a pantalla completa en el teléfono). */
export function PanelLateral({ titulo, subtitulo, onCerrar, pie, children }) {
  const idTitulo = `${useId()}-titulo`;
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  return (
    <div
      className="mz-overlay"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <aside
        className="mz-drawer gt-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        ref={panelRef}
        tabIndex={-1}
      >
        <Cabecera
          idTitulo={idTitulo}
          titulo={titulo}
          subtitulo={subtitulo}
          onCerrar={onCerrar}
        />
        <div className="gt-panel__cuerpo">{children}</div>
        {pie && <div className="gt-panel__pie">{pie}</div>}
      </aside>
    </div>
  );
}
