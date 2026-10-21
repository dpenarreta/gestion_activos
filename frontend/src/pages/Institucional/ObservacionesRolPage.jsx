import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { nominaService } from "../../api/nominaService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import "./Institucional.css";

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
const PESTANAS = [
  ["abierta", "Por atender"],
  ["corregida", "Por confirmar"],
  ["cerrada", "Confirmadas"],
  ["", "Todas"],
];
const CLASES = {
  abierta: "sugerencia-estado--nuevo",
  corregida: "sugerencia-estado--en_revision",
  cerrada: "sugerencia-estado--resuelto",
};

function Estado({ fila }) {
  return (
    <span className={`sugerencia-estado ${CLASES[fila.estado] ?? ""}`}>
      {fila.estado_display}
    </span>
  );
}

/** El detalle: el historial y, si está por atender, corregirla. */
function Detalle({ id, onCambio, onCerrar }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const [datos, setDatos] = useState(null);
  const [nota, setNota] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    nominaService
      .observacion(id)
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo abrir la observación.")),
      );
  }, [id]);

  async function corregir() {
    setGuardando(true);
    setError(null);
    try {
      setDatos(await nominaService.corregirObservacion(id, nota));
      setNota("");
      onCambio();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
    } finally {
      setGuardando(false);
    }
  }

  const titulo = datos
    ? `${datos.persona.nombre} · ${MESES[datos.mes - 1]} ${datos.anio}`
    : "Observación";

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal mz-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>{titulo}</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body mz-stack">
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {datos && (
            <>
              <div className="sugerencia-datos">
                <span>Código {datos.codigo}</span>
                <Estado fila={datos} />
              </div>
              <ol className="sugerencia-comentarios" aria-label="Historial">
                {datos.mensajes.map((m) => (
                  <li key={m.id}>
                    <strong>{m.tipo_display}</strong>{" "}
                    <small className="mz-faint">
                      · {m.autor} · {formatearFecha(m.fecha, true)}
                    </small>
                    {m.texto && <p className="mb-0">{m.texto}</p>}
                  </li>
                ))}
              </ol>
              {datos.estado === "abierta" ? (
                <div className="mz-stack">
                  <label
                    className="form-label mz-small mb-0"
                    htmlFor="obs-nota"
                  >
                    Qué se corrigió (lo verá la persona)
                  </label>
                  <textarea
                    id="obs-nota"
                    rows={3}
                    maxLength={2000}
                    className="form-control form-control-sm"
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                  />
                  <div className="mz-actions justify-content-end">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!nota.trim() || guardando}
                      onClick={corregir}
                    >
                      <Icon name="check2-square" /> Marcar como corregido y
                      pedir confirmación
                    </button>
                  </div>
                </div>
              ) : datos.estado === "corregida" ? (
                <p className="mz-faint mb-0">
                  Se le pidió a la persona que revise su rol y confirme. Se le
                  avisará cuando lo haga.
                </p>
              ) : (
                <p className="mz-faint mb-0">
                  La persona confirmó que está de acuerdo con su rol.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Institucional → Observaciones de roles (`roles_pago.observaciones`): lo que
 * las personas observaron de su rol de pagos. Talento Humano lo corrige y les
 * pide que vuelvan a confirmar; se cierra cuando dicen que están de acuerdo.
 */
export function ObservacionesRolPage() {
  const [parametros, setParametros] = useSearchParams();
  const [estado, setEstado] = useState("abierta");
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);
  const abierta = parametros.get("observacion");

  const cargar = useCallback(
    () =>
      nominaService
        .observaciones(estado)
        .then(setLista)
        .catch((err) =>
          setError(
            mensajeDeError(err, "No se pudieron cargar las observaciones."),
          ),
        ),
    [estado],
  );

  useEffect(() => {
    cargar();
  }, [cargar]);

  function abrir(id) {
    const nuevos = new URLSearchParams(parametros);
    if (id) nuevos.set("observacion", id);
    else nuevos.delete("observacion");
    setParametros(nuevos);
  }

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Observaciones a los roles de pagos</h2>
          <p className="mz-desc">
            Lo que las personas indicaron que no está correcto en su rol. Tras
            corregirlo, se les pide que vuelvan a confirmar.
          </p>
        </div>
      </div>
      <div className="mz-tabs" role="tablist">
        {PESTANAS.map(([id, texto]) => (
          <button
            key={id || "todas"}
            type="button"
            role="tab"
            aria-selected={estado === id}
            className={estado === id ? "is-active" : undefined}
            onClick={() => setEstado(id)}
          >
            {texto}
          </button>
        ))}
      </div>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {lista && lista.length === 0 && (
        <p className="mz-faint">No hay observaciones aquí.</p>
      )}
      {lista && lista.length > 0 && (
        <div className="mz-card">
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Código</th>
                  <th>Período</th>
                  <th>Observación</th>
                  <th>Estado</th>
                  <th>Actualizada</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0 text-start"
                        onClick={() => abrir(f.id)}
                      >
                        {f.persona.nombre}
                      </button>
                    </td>
                    <td>{f.codigo}</td>
                    <td className="text-capitalize">
                      {MESES[f.mes - 1]} {f.anio}
                    </td>
                    <td className="mz-small">{f.ultima}</td>
                    <td>
                      <Estado fila={f} />
                    </td>
                    <td>{formatearFecha(f.actualizada)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {abierta && (
        <Detalle id={abierta} onCambio={cargar} onCerrar={() => abrir(null)} />
      )}
    </div>
  );
}
