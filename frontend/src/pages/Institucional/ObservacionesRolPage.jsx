import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { nominaService } from "../../api/nominaService";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import {
  ACEPTA_ADJUNTOS,
  AdjuntosObservacion,
  MAXIMO_ADJUNTOS,
  pesoLegible,
  TAMANO_MAXIMO,
} from "./AdjuntosObservacion";
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
// «todas» se pide al servidor sin estado.
const PESTANAS = [
  { id: "abierta", etiqueta: "Por atender" },
  { id: "corregida", etiqueta: "Por confirmar" },
  { id: "cerrada", etiqueta: "Confirmadas" },
  { id: "todas", etiqueta: "Todas" },
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
  const [archivos, setArchivos] = useState([]);
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
      setDatos(await nominaService.corregirObservacion(id, nota, archivos));
      setNota("");
      setArchivos([]);
      onCambio();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
    } finally {
      setGuardando(false);
    }
  }

  function agregar(evento) {
    const elegidos = Array.from(evento.target.files ?? []);
    evento.target.value = "";
    const grandes = elegidos.filter((a) => a.size > TAMANO_MAXIMO);
    const validos = elegidos.filter((a) => a.size <= TAMANO_MAXIMO);
    const juntos = [...archivos, ...validos];
    setError(
      grandes.length
        ? `${grandes.map((a) => `«${a.name}»`).join(", ")} pesa más de 10 MB.`
        : juntos.length > MAXIMO_ADJUNTOS
          ? `Adjunte hasta ${MAXIMO_ADJUNTOS} archivos.`
          : null,
    );
    setArchivos(juntos.slice(0, MAXIMO_ADJUNTOS));
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
                    <AdjuntosObservacion adjuntos={m.adjuntos} />
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
                  <div>
                    <label className="btn btn-outline-secondary btn-sm mb-0">
                      <Icon name="paperclip" /> Adjuntar imágenes o archivos
                      <input
                        type="file"
                        className="d-none"
                        aria-label="Adjuntar imágenes o archivos"
                        multiple
                        accept={ACEPTA_ADJUNTOS}
                        disabled={archivos.length >= MAXIMO_ADJUNTOS}
                        onChange={agregar}
                      />
                    </label>
                    <small className="mz-faint ms-2">
                      Hasta {MAXIMO_ADJUNTOS}: imágenes, PDF, Word o Excel de
                      hasta 10 MB. Quedan en el historial.
                    </small>
                    {archivos.length > 0 && (
                      <ul className="obs-elegidos" aria-label="Por adjuntar">
                        {archivos.map((a, i) => (
                          <li key={`${a.name}-${i}`}>
                            <Icon name="paperclip" /> {a.name}{" "}
                            <small className="mz-faint">
                              ({pesoLegible(a.size)})
                            </small>
                            <button
                              type="button"
                              className="btn btn-link btn-sm text-danger px-1"
                              aria-label={`Quitar ${a.name}`}
                              onClick={() =>
                                setArchivos((lista) =>
                                  lista.filter((_, j) => j !== i),
                                )
                              }
                            >
                              <Icon name="x-lg" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
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

  const cargar = useCallback(() => {
    // Se vacía antes de pedir: «Cargando…» en vez de la lista de la pestaña
    // anterior, y sin el error viejo (auditoría UX/UI, fase 2, 28/10/2026).
    setLista(null);
    setError(null);
    return nominaService
      .observaciones(estado)
      .then(setLista)
      .catch((err) =>
        setError(
          mensajeDeError(err, "No se pudieron cargar las observaciones."),
        ),
      );
  }, [estado]);

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
      <Pestanas
        etiqueta="Observaciones por estado"
        idBase="obs"
        valor={estado || "todas"}
        onCambio={(id) => setEstado(id === "todas" ? "" : id)}
        opciones={PESTANAS}
      />
      <PanelDePestana idBase="obs" valor={estado || "todas"}>
        <EstadoDeCarga
          cargando={lista === null}
          error={error}
          onReintentar={cargar}
          vacio={lista?.length === 0}
          textoVacio="No hay observaciones aquí."
        />
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
      </PanelDePestana>
      {abierta && (
        <Detalle id={abierta} onCambio={cargar} onCerrar={() => abrir(null)} />
      )}
    </div>
  );
}
