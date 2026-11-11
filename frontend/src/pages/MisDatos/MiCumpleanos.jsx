import { useState } from "react";

import { misDatosService } from "../../api/misDatosService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { useTextoVigente } from "../../hooks/useTextoVigente";
import { mensajeDeError } from "../../utils/errores";
import {
  CLAVES_TEXTO,
  esTextoCambiado,
  mensajeDeTextoCambiado,
} from "../Privacidad/privacidadComunes";
import { CasillaDeAceptacion } from "./CasillaDeAceptacion";

/** El texto que estuvo fijo hasta US-004 (11/11/2026): hoy se lee del
 * catálogo y este es solo el respaldo mientras llega. */
const RESPALDO =
  "Acepto que mi día de cumpleaños sea información pública dentro de la empresa.";

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function diaYMes(dia, mes) {
  return `${dia} de ${MESES[mes - 1]}`;
}

/** Activar: aceptar que sea público y dar la fecha (solo cuentan día y mes). */
function VentanaPublicar({ onPublicado, onCerrar }) {
  const [fecha, setFecha] = useState("");
  const [acepto, setAcepto] = useState(false);
  // Lo que se acepta es el texto vigente del servidor; sin él, no se acepta.
  const vigente = useTextoVigente(CLAVES_TEXTO.CUMPLEANOS, RESPALDO);
  const [error, setError] = useState(null);
  // El error de la casilla (el texto cambió mientras se leía), junto a ella.
  const [errorCasilla, setErrorCasilla] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });

  async function confirmar(evento) {
    evento.preventDefault();
    if (!fecha) {
      setError("Indique la fecha de su cumpleaños.");
      return;
    }
    const [, mes, dia] = fecha.split("-").map(Number);
    setGuardando(true);
    setError(null);
    setErrorCasilla(null);
    try {
      onPublicado(
        await misDatosService.guardarCumpleanos({
          mostrar: true,
          acepto,
          // La versión que leyó: si cambió, el servidor lo rechaza.
          version: vigente.version,
          dia,
          mes,
        }),
      );
    } catch (err) {
      if (esTextoCambiado(err)) {
        setAcepto(false);
        vigente.reintentar();
        setErrorCasilla(mensajeDeTextoCambiado(err));
      } else {
        setError(mensajeDeError(err, "No se pudo guardar."));
      }
      setGuardando(false);
    }
  }

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cumple-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="cumple-titulo">
            <Icon name="gift" /> Mostrar mi cumpleaños
          </h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <form className="mz-panel-body mz-stack" onSubmit={confirmar}>
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          <p className="mb-0">
            Su cumpleaños aparecerá en el calendario de Inicio, que ve{" "}
            <strong>toda la empresa</strong>, como «Cumpleaños de» su nombre,
            todos los años. Se muestran solo el día y el mes: el año no se
            guarda. Puede dejar de mostrarlo cuando quiera.
          </p>
          <div>
            <label className="form-label" htmlFor="cumple-fecha">
              Fecha de su cumpleaños
            </label>
            <input
              id="cumple-fecha"
              type="date"
              required
              className="form-control"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </div>
          <CasillaDeAceptacion
            id="cumple-acepto"
            vigente={vigente}
            error={errorCasilla}
            etiquetaNeutra="Acepto que mi cumpleaños sea público"
            acepto={acepto}
            onCambio={(si) => {
              setAcepto(si);
              setErrorCasilla(null);
            }}
          />
          <div className="mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm mz-tactil"
              onClick={onCerrar}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm mz-tactil"
              disabled={!acepto || !vigente.delServidor || guardando}
            >
              {guardando ? "Guardando…" : "Aceptar y mostrar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * «Mi perfil» → Mi cumpleaños en el calendario: cada persona decide si se
 * muestra. Activarlo pide aceptar que sea público y la fecha; desactivarlo lo
 * retira del calendario y borra la fecha. Se cambia cuando se quiera.
 */
export function MiCumpleanos({ inicial }) {
  const [estado, setEstado] = useState(
    inicial ?? { mostrar: false, dia: null, mes: null },
  );
  const [ventana, setVentana] = useState(false);
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);

  async function retirar() {
    setError(null);
    setMensaje(null);
    try {
      setEstado(await misDatosService.guardarCumpleanos({ mostrar: false }));
      setMensaje("Su cumpleaños ya no se muestra en el calendario.");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
    }
  }

  return (
    <section className="mz-card" aria-labelledby="mi-cumple-titulo">
      <div className="mz-card-body mz-stack">
        <div className="d-flex align-items-start justify-content-between gap-3">
          <div>
            <h3 id="mi-cumple-titulo" className="h6 mb-1">
              <Icon name="gift" /> Mi cumpleaños en el calendario
            </h3>
            <p className="mz-faint mz-small mb-0">
              {estado.mostrar
                ? `Se muestra el ${diaYMes(estado.dia, estado.mes)} en el calendario de Inicio.`
                : "No se muestra. Si lo activa, toda la empresa verá su día de cumpleaños."}
            </p>
          </div>
          <label className="form-check form-switch mb-0">
            <input
              type="checkbox"
              role="switch"
              className="form-check-input"
              aria-label="Mostrar mi cumpleaños en el calendario"
              checked={estado.mostrar}
              onChange={(e) => {
                setMensaje(null);
                if (e.target.checked) setVentana(true);
                else retirar();
              }}
            />
          </label>
        </div>
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        {mensaje && (
          <div className="mz-alert mz-alert--info" role="status">
            <Icon name="check2-circle" />
            {mensaje}
          </div>
        )}
      </div>
      {ventana && (
        <VentanaPublicar
          onCerrar={() => setVentana(false)}
          onPublicado={(nuevo) => {
            setEstado(nuevo);
            setVentana(false);
            setMensaje(
              `Listo: su cumpleaños se muestra el ${diaYMes(nuevo.dia, nuevo.mes)}.`,
            );
          }}
        />
      )}
    </section>
  );
}
