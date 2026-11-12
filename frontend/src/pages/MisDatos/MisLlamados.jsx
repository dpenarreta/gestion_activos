import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { llamadosService } from "../../api/llamadosService";
import { Icon } from "../../components/common/Icon/Icon";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha, formatearMoneda } from "../../utils/formato";
import {
  SANCION,
  causaDe,
  nivelDe,
  nombreDe,
  tipoDe,
} from "../GestionHumana/LlamadosAtencion/llamadosComunes";
import "./MiCargo.css";

const CELULAR = "(max-width: 575.98px)";

function Monto({ llamado }) {
  return tipoDe(llamado) === SANCION || llamado.monto
    ? formatearMoneda(llamado.monto)
    : "—";
}

function Anulado() {
  return (
    <span className="mz-faint">
      <Icon name="slash-circle" /> Anulado: no cuenta
    </span>
  );
}

/**
 * «Mi perfil» → Mis llamados de atención (US-013, CA-8): solo lectura, con la
 * fecha del hecho, el número, la causa, el nivel, la descripción y el monto de
 * las sanciones. `mios/` ya deja fuera las solicitudes pendientes y las
 * rechazadas, y no trae quién lo solicitó.
 *
 * Decisiones: sin llamados, la sección no se muestra (la mayoría de las
 * personas no tiene ninguno y un «vacío» a diario sería ruido); los anulados
 * se marcan con la etiqueta atenuada «Anulado: no cuenta» (el texto del
 * llamado conserva su color), porque la persona recibió
 * el aviso y debe poder ver que ya no cuenta. Si el servidor responde 403 o
 * 404 (sin la función), tampoco se muestra; cualquier otro fallo sí lo dice,
 * con reintento. `?seccion=llamados` (el enlace del aviso) lleva el foco aquí.
 */
export function MisLlamados() {
  const [llamados, setLlamados] = useState(null);
  const [error, setError] = useState(null);
  const [parametros] = useSearchParams();
  const titulo = useRef(null);
  const enTarjetas = useMediaQuery(CELULAR);
  const pedida = parametros.get("seccion") === "llamados";

  const cargar = useCallback(() => {
    setError(null);
    return llamadosService
      .mios()
      .then(setLlamados)
      .catch((err) => {
        const estado = err?.response?.status;
        if (estado === 403 || estado === 404) setLlamados([]);
        else setError(mensajeDeError(err, "No se pudieron cargar."));
      });
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const visible = Boolean(error) || (llamados !== null && llamados.length > 0);

  // El aviso de la campana enlaza aquí: se desplaza hasta la sección y el
  // foco queda en su título, para que el lector la anuncie.
  useEffect(() => {
    if (!pedida || !visible) return;
    titulo.current?.scrollIntoView?.({ block: "start" });
    titulo.current?.focus();
  }, [pedida, visible]);

  if (!visible) return null;

  return (
    <section className="mz-card mi-cargo" aria-labelledby="mis-llamados-titulo">
      <div className="mz-card-body mz-stack">
        <div>
          <h3
            id="mis-llamados-titulo"
            className="h6 mb-1"
            tabIndex={-1}
            ref={titulo}
          >
            <Icon name="journal-text" /> Mis llamados de atención
          </h3>
          <p className="mz-faint mz-small mb-0">
            Aquí puede consultar los llamados de atención registrados a su
            nombre. Si tiene dudas o desea presentar sus observaciones,
            comuníquese con Gestión Humana.
          </p>
        </div>
        {error ? (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            <span className="flex-grow-1">
              Mis llamados de atención: {error}
            </span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm mz-tactil"
              onClick={cargar}
            >
              Reintentar
            </button>
          </div>
        ) : enTarjetas ? (
          <ul className="mz-cards-lista" aria-label="Mis llamados de atención">
            {llamados.map((l) => (
              <li key={l.id} className="mz-card-row">
                <strong>{nombreDe(causaDe(l))}</strong>
                <div className="mz-card-meta">
                  <span>Fecha del hecho: {formatearFecha(l.fecha_hecho)}</span>
                  {l.numero && <span>N.º {l.numero}</span>}
                  <span>{nombreDe(nivelDe(l))}</span>
                  {(tipoDe(l) === SANCION || l.monto) && (
                    <span>
                      Monto de la sanción: <Monto llamado={l} />
                    </span>
                  )}
                </div>
                <p className="mb-0" style={{ whiteSpace: "pre-wrap" }}>
                  {l.descripcion}
                </p>
                {l.estado === "anulado" && <Anulado />}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mz-table-wrap">
            <table className="mz-table">
              <caption className="visually-hidden">
                Mis llamados de atención
              </caption>
              <thead>
                <tr>
                  <th scope="col">Fecha del hecho</th>
                  <th scope="col">N.º</th>
                  <th scope="col">Causa</th>
                  <th scope="col">Nivel</th>
                  <th scope="col">Descripción</th>
                  <th scope="col">Monto de la sanción</th>
                </tr>
              </thead>
              <tbody>
                {llamados.map((l) => (
                  <tr key={l.id}>
                    <td>{formatearFecha(l.fecha_hecho)}</td>
                    <td>{l.numero ?? "—"}</td>
                    <td>{nombreDe(causaDe(l))}</td>
                    <td>
                      {nombreDe(nivelDe(l))}
                      {l.estado === "anulado" && (
                        <>
                          <br />
                          <Anulado />
                        </>
                      )}
                    </td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{l.descripcion}</td>
                    <td className="num">
                      <Monto llamado={l} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
