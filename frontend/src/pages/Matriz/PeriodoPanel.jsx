import { useCallback, useEffect, useState } from "react";

import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import {
  ICONO_DEL_GRUPO,
  PILDORA_DEL_GRUPO,
  PRIORIDADES,
  diaCorto,
  fechaHora,
} from "./formatoMatriz";
import { SeguimientoModal } from "./SeguimientoModal";

const TIPOS = {
  regulatoria: "Regulatoria",
  contractual: "Contractual",
  interna: "Interna",
};
const PERIODICIDADES = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  unica: "Única",
};

function Kv({ etiqueta, children, completo }) {
  return (
    <div className={`mz-kv ${completo ? "mz-kv--full" : ""}`}>
      <span className="mz-kv-label">{etiqueta}</span>
      {children ?? "—"}
    </div>
  );
}

function Persona({ persona }) {
  if (!persona) return "—";
  return (
    <>
      {persona.nombre}
      {persona.email && (
        <span className="mz-small mz-faint d-block">{persona.email}</span>
      )}
    </>
  );
}

/**
 * El detalle de un período, en un panel lateral (§15.4).
 *
 * Se abre desde cualquier pantalla de la Matriz con `?periodo=ID` en la
 * dirección, así que se puede compartir y sobrevive a recargar. Se cierra con
 * la X, Esc o un clic fuera. Los botones son los que el servidor calcula en
 * `acciones`: un botón que termina en un 403 hace parecer roto el sistema.
 */
export function PeriodoPanel({ id, onCerrar, onCambio }) {
  const [periodo, setPeriodo] = useState(null);
  const [historial, setHistorial] = useState(null);
  const [error, setError] = useState(null);
  const [pestana, setPestana] = useState("general");
  const [editando, setEditando] = useState(false);

  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });

  const cargar = useCallback(() => {
    matrizService
      .periodo(id)
      .then(setPeriodo)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo abrir el período.")),
      );
    matrizService
      .historial(id)
      .then(setHistorial)
      .catch(() => setHistorial([]));
  }, [id]);

  useEffect(() => {
    setPeriodo(null);
    setError(null);
    cargar();
  }, [cargar]);

  const zona = periodo?.empresa?.zona_horaria;
  const estado = periodo?.estado;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="mz-overlay" onClick={handleBackdropClick}>
      <aside
        ref={panelRef}
        className="mz-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="periodo-titulo"
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <div className="min-w-0">
            {periodo ? (
              <>
                <span className="mz-code">
                  {periodo.codigo} · {periodo.etiqueta}
                </span>
                <h3 id="periodo-titulo">{periodo.obligacion.nombre}</h3>
                <div className="mz-pill-row">
                  <span
                    className={`mz-pill ${PILDORA_DEL_GRUPO[estado.group]}`}
                  >
                    <Icon name={ICONO_DEL_GRUPO[estado.group]} /> {estado.label}
                  </span>
                  <span className="mz-pill mz-pill--neutral">
                    {TIPOS[periodo.obligacion.tipo]}
                  </span>
                  <span className="mz-pill mz-pill--neutral">
                    {periodo.empresa.nombre}
                  </span>
                </div>
              </>
            ) : (
              <h3 id="periodo-titulo">{error ? "Período" : "Cargando…"}</h3>
            )}
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

        <div className="mz-panel-body">
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}

          {periodo && (
            <>
              <div
                className="mz-tabs"
                role="tablist"
                aria-label="Detalle del período"
              >
                {[
                  ["general", "General"],
                  ["historial", "Historial"],
                ].map(([clave, nombre]) => (
                  <button
                    key={clave}
                    type="button"
                    role="tab"
                    aria-selected={pestana === clave}
                    className={pestana === clave ? "is-active" : undefined}
                    onClick={() => setPestana(clave)}
                  >
                    {nombre}
                  </button>
                ))}
              </div>

              {pestana === "general" && (
                <div role="tabpanel" aria-label="General">
                  {periodo.acciones.includes("edit") && (
                    <div className="mz-actions mb-3">
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() => setEditando(true)}
                      >
                        <Icon name="pencil" /> Editar seguimiento
                      </button>
                    </div>
                  )}
                  {periodo.recordatorios_suspendidos && (
                    <div className="mz-alert mz-alert--info" role="status">
                      <Icon name="bell-slash" />
                      Los recordatorios de este período están suspendidos.
                    </div>
                  )}

                  <div className="mz-section">
                    <h4>Identificación</h4>
                    <div className="mz-kv-grid">
                      <Kv etiqueta="Sucursal">{periodo.sede?.nombre}</Kv>
                      <Kv etiqueta="Área">{periodo.obligacion.area_nombre}</Kv>
                      <Kv etiqueta="Entidad de control">
                        {periodo.obligacion.entidad_nombre}
                      </Kv>
                      <Kv etiqueta="Periodicidad">
                        {PERIODICIDADES[periodo.obligacion.periodicidad]}
                      </Kv>
                      <Kv etiqueta="Evidencia esperada" completo>
                        {periodo.obligacion.evidencia_esperada}
                      </Kv>
                      {periodo.obligacion.descripcion && (
                        <Kv etiqueta="Descripción" completo>
                          {periodo.obligacion.descripcion}
                        </Kv>
                      )}
                      {(periodo.obligacion.fundamento_legal ||
                        periodo.obligacion.fundamento_url) && (
                        <Kv etiqueta="Fundamento legal" completo>
                          {periodo.obligacion.fundamento_legal}{" "}
                          {periodo.obligacion.fundamento_url && (
                            <a
                              href={periodo.obligacion.fundamento_url}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              Ver fuente <Icon name="box-arrow-up-right" />
                            </a>
                          )}
                        </Kv>
                      )}
                    </div>
                  </div>

                  <div className="mz-section">
                    <h4>Fechas</h4>
                    <div className="mz-kv-grid">
                      <Kv etiqueta="Inicio">
                        {diaCorto(periodo.fecha_inicio)}
                      </Kv>
                      <Kv etiqueta="Preparación">
                        {diaCorto(periodo.fecha_preparacion)}
                      </Kv>
                      <Kv etiqueta="Vencimiento">
                        {fechaHora(periodo.vence_en, zona)}
                      </Kv>
                      {periodo.cerrado && (
                        <>
                          <Kv etiqueta="Cumplimiento">
                            {fechaHora(periodo.cumplido_en, zona)}
                          </Kv>
                          <Kv etiqueta="Validación">
                            {fechaHora(periodo.validado_en, zona)}
                            {periodo.validado_por &&
                              ` · ${periodo.validado_por.nombre}`}
                          </Kv>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mz-section">
                    <h4>Responsables</h4>
                    <div className="mz-kv-grid">
                      <Kv etiqueta="Responsable">
                        <Persona persona={periodo.responsable} />
                      </Kv>
                      <Kv etiqueta="Suplente">
                        <Persona persona={periodo.suplente} />
                      </Kv>
                      <Kv etiqueta="Supervisor">
                        <Persona persona={periodo.supervisor} />
                      </Kv>
                      <Kv etiqueta="Aprobador">
                        <Persona persona={periodo.aprobador} />
                      </Kv>
                    </div>
                  </div>

                  <div className="mz-section">
                    <h4>Seguimiento</h4>
                    <div className="mz-kv-grid">
                      <Kv etiqueta="Prioridad">
                        <span className={`mz-prio--${periodo.prioridad}`}>
                          {PRIORIDADES[periodo.prioridad]}
                        </span>
                      </Kv>
                      <Kv etiqueta="Avance">
                        {periodo.avance} %
                        <div
                          className="mz-progress"
                          role="progressbar"
                          aria-valuenow={periodo.avance}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="Avance"
                        >
                          <div style={{ width: `${periodo.avance}%` }} />
                        </div>
                      </Kv>
                      <Kv etiqueta="Observaciones" completo>
                        {periodo.observaciones || "—"}
                      </Kv>
                    </div>
                  </div>
                </div>
              )}

              {pestana === "historial" && (
                <div role="tabpanel" aria-label="Historial">
                  {historial === null ? (
                    <div className="mz-empty">Cargando…</div>
                  ) : (
                    <div className="mz-timeline">
                      {historial.map((evento) => (
                        <div key={evento.id} className="mz-tl-item">
                          <div className="mz-tl-when">
                            {fechaHora(evento.created_at, zona)} ·{" "}
                            {evento.actor}
                          </div>
                          <div className="mz-tl-what">{evento.descripcion}</div>
                          {(evento.valor_anterior || evento.valor_nuevo) && (
                            <div className="mz-tl-why">
                              {evento.valor_anterior || "—"} →{" "}
                              {evento.valor_nuevo || "—"}
                            </div>
                          )}
                          {evento.motivo && (
                            <div className="mz-tl-why">{evento.motivo}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {editando && periodo && (
        <SeguimientoModal
          periodo={periodo}
          onCerrar={() => setEditando(false)}
          onGuardado={() => {
            setEditando(false);
            cargar();
            onCambio?.();
          }}
        />
      )}
    </div>
  );
}
