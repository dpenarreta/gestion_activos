import { Icon } from "../../components/common/Icon/Icon";
import "./CasillaDeAceptacion.css";

/**
 * La casilla «Acepto…» de un texto de protección de datos que se acepta en
 * «Mi perfil» (cumpleaños, aniversario, teléfono). El texto es el vigente del
 * catálogo (US-004, 11/11/2026: se edita en «Protección de datos» →
 * «Textos»), que llega con `useTextoVigente` (`vigente`).
 *
 * Lo que se acepta tiene que ser el texto vigente del servidor (CA-8):
 * - mientras llega, un esqueleto (no el respaldo, que podría quedar viejo);
 * - si no llega, el respaldo para leer, con «Reintentar», y la casilla
 *   deshabilitada con una etiqueta neutra. El texto va en un párrafo aparte
 *   (enlazado con `aria-describedby`) y no en la etiqueta deshabilitada:
 *   Bootstrap la atenúa y bajaba el contraste a 3,2:1 (QA-UX, ronda 1).
 */
export function CasillaDeAceptacion({
  id,
  vigente,
  acepto,
  onCambio,
  etiquetaNeutra = "Acepto el texto",
  error,
}) {
  const listo = vigente.delServidor;
  const idTexto = `${id}-texto`;
  const idEstado = `${id}-estado`;
  const idError = `${id}-error`;
  return (
    <div className="md-casilla">
      {listo ? (
        <label className="form-check mb-0" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            className={`form-check-input${error ? " is-invalid" : ""}`}
            checked={acepto}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? idError : undefined}
            onChange={(e) => onCambio(e.target.checked)}
          />{" "}
          <span className="form-check-label">{vigente.texto}</span>
        </label>
      ) : (
        <>
          {vigente.cargando ? (
            <div className="md-casilla__esqueleto" aria-hidden="true">
              <span />
              <span />
            </div>
          ) : (
            vigente.texto && (
              <p id={idTexto} className="md-casilla__texto mb-0">
                {vigente.texto}
              </p>
            )
          )}
          <div className="md-casilla__fila">
            <input
              id={id}
              type="checkbox"
              className="form-check-input"
              checked={false}
              disabled
              aria-describedby={
                vigente.cargando || !vigente.texto
                  ? idEstado
                  : `${idTexto} ${idEstado}`
              }
              readOnly
            />
            <label htmlFor={id} className="md-casilla__etiqueta">
              {etiquetaNeutra}
            </label>
          </div>
        </>
      )}
      {/* El error del servidor, junto a la casilla (p. ej. el texto cambió
          mientras se leía). */}
      {error && (
        <div id={idError} className="mz-field-error">
          {error}
        </div>
      )}
      {/* Siempre montada: así se anuncia lo que entra en ella. */}
      <div id={idEstado} role="status" className="md-casilla__estado">
        {!listo && vigente.cargando && (
          <span className="mz-small mz-faint">Cargando el texto vigente…</span>
        )}
        {!listo && !vigente.cargando && (
          <div className="mz-alert mz-alert--bad mb-0">
            <Icon name="x-octagon" />
            <span className="flex-grow-1">
              No se pudo cargar el texto vigente: sin él no se puede aceptar.
            </span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm mz-tactil"
              onClick={vigente.reintentar}
            >
              Reintentar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
