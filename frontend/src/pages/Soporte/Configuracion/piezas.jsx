/*
 * Piezas comunes de Configuración → Mesa de ayuda (auditoría UX/UI,
 * 30/10/2026): una lista de casillas en lugar del selector múltiple (un clic
 * sin Ctrl borraba la selección entera), un tiempo en horas y minutos en
 * lugar de «0,25 h», y una ventana con «Guardar» y «Cancelar».
 */
import { useId, useState } from "react";
import { createPortal } from "react-dom";

import { Icon } from "../../../components/common/Icon/Icon";
import { useModalA11y } from "../../../hooks/useModalA11y";

/** Varias opciones con casillas; con buscador si son muchas. */
export function ListaDeCasillas({
  etiqueta,
  opciones,
  valor,
  onCambiar,
  vacio = "No hay opciones.",
}) {
  const id = useId();
  const [buscar, setBuscar] = useState("");
  const elegidos = new Set(valor.map(String));
  const texto = buscar.trim().toLowerCase();
  const visibles = texto
    ? opciones.filter((o) => o.nombre.toLowerCase().includes(texto))
    : opciones;
  return (
    <fieldset className="soporte-casillas">
      <legend className="form-label">
        {etiqueta}{" "}
        <span className="mz-faint fw-normal mz-small">
          ({elegidos.size} elegid{elegidos.size === 1 ? "a" : "as"})
        </span>
      </legend>
      {opciones.length > 8 && (
        <input
          type="search"
          className="form-control form-control-sm mb-2"
          placeholder="Buscar"
          aria-label={`Buscar en ${etiqueta}`}
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
      )}
      <div className="soporte-casillas__lista">
        {visibles.map((o) => (
          <div className="form-check" key={o.id}>
            <input
              id={`${id}-${o.id}`}
              type="checkbox"
              className="form-check-input"
              checked={elegidos.has(String(o.id))}
              onChange={(e) =>
                onCambiar(
                  e.target.checked
                    ? [...valor, o.id]
                    : valor.filter((v) => String(v) !== String(o.id)),
                )
              }
            />
            <label className="form-check-label" htmlFor={`${id}-${o.id}`}>
              {o.nombre}
            </label>
          </div>
        ))}
        {visibles.length === 0 && (
          <p className="mz-small mz-faint mb-0">
            {texto ? "Nada coincide con la búsqueda." : vacio}
          </p>
        )}
      </div>
    </fieldset>
  );
}

/** Minutos ⇄ horas y minutos. */
export function partirMinutos(minutos) {
  if (minutos === null || minutos === undefined || minutos === "")
    return { horas: "", minutos: "" };
  return {
    horas: String(Math.floor(minutos / 60)),
    minutos: String(minutos % 60),
  };
}

export function juntarMinutos({ horas, minutos }) {
  if (horas === "" && minutos === "") return null;
  return Number(horas || 0) * 60 + Number(minutos || 0);
}

/** Un tiempo en horas y minutos («1 h 30 min»), no en fracciones de hora. */
export function CampoDuracion({
  id,
  etiqueta,
  valor,
  onCambiar,
  ayuda,
  error,
  obligatorio = false,
}) {
  const describe = [ayuda && `${id}-ayuda`, error && `${id}-error`]
    .filter(Boolean)
    .join(" ");
  return (
    <fieldset
      className="soporte-duracion"
      aria-describedby={describe || undefined}
    >
      <legend className="form-label mz-small mb-1">
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
      </legend>
      <div className="soporte-duracion__campos">
        <label className="visually-hidden" htmlFor={`${id}-h`}>
          Horas
        </label>
        <input
          id={`${id}-h`}
          type="number"
          min="0"
          inputMode="numeric"
          className={`form-control form-control-sm${error ? " is-invalid" : ""}`}
          aria-invalid={error ? true : undefined}
          value={valor.horas}
          onChange={(e) => onCambiar({ ...valor, horas: e.target.value })}
        />
        <span aria-hidden="true">h</span>
        <label className="visually-hidden" htmlFor={`${id}-m`}>
          Minutos
        </label>
        <input
          id={`${id}-m`}
          type="number"
          min="0"
          max="59"
          inputMode="numeric"
          className={`form-control form-control-sm${error ? " is-invalid" : ""}`}
          aria-invalid={error ? true : undefined}
          value={valor.minutos}
          onChange={(e) => onCambiar({ ...valor, minutos: e.target.value })}
        />
        <span aria-hidden="true">min</span>
      </div>
      {ayuda && (
        <div id={`${id}-ayuda`} className="form-text">
          {ayuda}
        </div>
      )}
      {error && (
        <div id={`${id}-error`} className="mz-field-error">
          {error}
        </div>
      )}
    </fieldset>
  );
}

/** Una ventana con su formulario, «Cancelar» y «Guardar». */
export function VentanaDeEdicion({
  titulo,
  children,
  onCerrar,
  onGuardar,
  guardando,
  error,
  textoBoton = "Guardar",
  ancha = false,
}) {
  const id = useId();
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  // En el cuerpo de la página: abierta desde una celda de tabla heredaba su
  // alineación a la derecha y los nombres quedaban lejos de sus casillas.
  return createPortal(
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={`mz-modal${ancha ? " mz-modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id={`${id}-titulo`}>{titulo}</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <form
          className="mz-panel-body"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onGuardar();
          }}
        >
          {children}
          {error && (
            <div className="mz-alert mz-alert--bad mt-3 mb-0" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          <div className="mz-actions justify-content-end mt-3">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onCerrar}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={guardando}
            >
              {guardando ? "Guardando…" : textoBoton}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
