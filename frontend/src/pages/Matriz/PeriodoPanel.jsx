import { useCallback, useEffect, useState } from "react";

import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import {
  ICONO_DEL_GRUPO,
  PILDORA_DEL_GRUPO,
  PERIODICIDADES,
  PRIORIDADES,
  diaCorto,
  fechaHora,
} from "./formatoMatriz";
import { FichaObligacion } from "./FichaObligacion";
import { CambiarFechaModal } from "./CambiarFechaModal";
import { CargarEvidenciaModal } from "./CargarEvidenciaModal";
import { DocumentosDelPeriodo } from "./DocumentosDelPeriodo";
import { MotivoModal } from "./MotivoModal";
import { RecordatoriosDelPeriodo } from "./RecordatoriosDelPeriodo";
import { SeguimientoModal } from "./SeguimientoModal";
import { ConfirmDialog } from "../../components/common/ConfirmDialog/ConfirmDialog";

const TIPOS = {
  regulatoria: "Regulatoria",
  contractual: "Contractual",
  interna: "Interna",
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
 * Los botones del período, en el orden del flujo, y solo los que el servidor
 * ofrece en `acciones` (§8.10).
 */
const BOTONES = [
  {
    accion: "submit",
    ventana: "enviar",
    texto: "Enviar a validación",
    icono: "send",
    clase: "btn-primary",
  },
  {
    accion: "validate",
    ventana: "validar",
    texto: "Validar y finalizar",
    icono: "check2-circle",
    clase: "btn-primary",
  },
  {
    accion: "return",
    ventana: "devolver",
    texto: "Devolver",
    icono: "arrow-counterclockwise",
    clase: "btn-outline-warning",
  },
  {
    accion: "upload",
    ventana: "cargar",
    texto: "Cargar evidencia",
    icono: "cloud-arrow-up",
    clase: "btn-outline-primary",
  },
  {
    accion: "edit",
    ventana: "seguimiento",
    texto: "Editar seguimiento",
    icono: "pencil",
    clase: "btn-outline-primary",
  },
  {
    accion: "change_due_date",
    ventana: "fecha",
    texto: "Cambiar fecha",
    icono: "calendar-event",
    clase: "btn-outline-secondary",
  },
  {
    accion: "remind",
    ventana: "recordar",
    texto: "Reenviar recordatorio",
    icono: "send",
    clase: "btn-outline-secondary",
  },
];

/** Las acciones que solo piden confirmación: qué llaman y qué avisan. */
const CONFIRMABLES = {
  enviar: {
    llamar: (id) => matrizService.enviar(id),
    aviso: "Enviado a validación.",
  },
  validar: {
    llamar: (id) => matrizService.validar(id),
    aviso: "Cierre validado.",
  },
  recordar: {
    llamar: (id) => matrizService.enviarRecordatorio(id),
    aviso: "Recordatorio enviado.",
  },
};

function BarraDeAcciones({ acciones, onAccion }) {
  const visibles = BOTONES.filter((b) => acciones.includes(b.accion));
  if (visibles.length === 0) return null;
  return (
    <div className="mz-actions mb-3">
      {visibles.map((b) => (
        <button
          key={b.accion}
          type="button"
          className={`btn btn-sm ${b.clase}`}
          onClick={() => onAccion(b.ventana)}
        >
          <Icon name={b.icono} /> {b.texto}
        </button>
      ))}
    </div>
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
  // La ventana abierta: seguimiento, fecha, carga, devolver, enviar o validar.
  const [ventana, setVentana] = useState(null);
  const [isConfirmando, setIsConfirmando] = useState(false);
  const [aviso, setAviso] = useState(null);
  // Sube cada vez que algo cambia, para que la pestaña Documentos se relea.
  const [version, setVersion] = useState(0);

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

  function despuesDeCambiar(mensaje) {
    setVentana(null);
    setAviso(mensaje ?? null);
    setVersion((v) => v + 1);
    cargar();
    onCambio?.();
  }

  async function confirmar(accion) {
    setIsConfirmando(true);
    try {
      await CONFIRMABLES[accion].llamar(id);
      despuesDeCambiar(CONFIRMABLES[accion].aviso);
    } catch (err) {
      setVentana(null);
      setError(mensajeDeError(err, "No se pudo completar la acción."));
    } finally {
      setIsConfirmando(false);
    }
  }

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
              <h3 id="periodo-titulo">
                {error || aviso ? "Período" : "Cargando…"}
              </h3>
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

          {aviso && (
            <div className="mz-alert mz-alert--info" role="status">
              <Icon name="check2-circle" />
              {aviso}
            </div>
          )}

          {periodo && (
            <>
              {/* Encima de las pestañas y no dentro de General: el siguiente
                  paso suele darse desde otra —tras cargar la evidencia en
                  Documentos, enviarla— y no debe obligar a volver. */}
              <BarraDeAcciones
                acciones={periodo.acciones}
                onAccion={setVentana}
              />
              <div
                className="mz-tabs"
                role="tablist"
                aria-label="Detalle del período"
              >
                {[
                  ["general", "General"],
                  ["documentos", "Documentos"],
                  ["recordatorios", "Recordatorios"],
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
                      <Kv etiqueta="Tema">{periodo.obligacion.area_nombre}</Kv>
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

                  <FichaObligacion
                    obligacion={periodo.obligacion}
                    puedeEditar={periodo.acciones?.includes("edit")}
                    onGuardada={() => despuesDeCambiar("Ficha guardada.")}
                  />

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

              {pestana === "documentos" && (
                <div role="tabpanel" aria-label="Documentos">
                  <DocumentosDelPeriodo
                    periodo={periodo}
                    version={version}
                    onCambio={() => despuesDeCambiar()}
                  />
                </div>
              )}

              {pestana === "recordatorios" && (
                <div role="tabpanel" aria-label="Recordatorios">
                  <RecordatoriosDelPeriodo
                    periodo={periodo}
                    version={version}
                  />
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

      {periodo && ventana === "seguimiento" && (
        <SeguimientoModal
          periodo={periodo}
          onCerrar={() => setVentana(null)}
          onGuardado={(actualizado) => {
            if (actualizado?.visible === false) {
              // Se cedió a otra persona: ya no es suyo y recargarlo daría un
              // 404 que parecería un fallo del guardado.
              setVentana(null);
              setPeriodo(null);
              setAviso(
                "Seguimiento guardado. El período ya no está entre los suyos: dejó de ser su responsable o suplente.",
              );
              onCambio?.();
              return;
            }
            despuesDeCambiar("Seguimiento actualizado.");
          }}
        />
      )}
      {periodo && ventana === "fecha" && (
        <CambiarFechaModal
          periodo={periodo}
          onCerrar={() => setVentana(null)}
          onGuardado={() => despuesDeCambiar("Fecha de vencimiento cambiada.")}
        />
      )}
      {periodo && ventana === "cargar" && (
        <CargarEvidenciaModal
          periodo={periodo}
          onCerrar={() => setVentana(null)}
          onCargado={() => {
            setVersion((v) => v + 1);
            cargar();
            onCambio?.();
          }}
        />
      )}
      {periodo && ventana === "devolver" && (
        <MotivoModal
          titulo="Devolver a preparación"
          subtitulo={`${periodo.codigo} · ${periodo.obligacion.nombre}`}
          etiqueta="Qué hay que corregir"
          textoConfirmar="Devolver"
          onCerrar={() => setVentana(null)}
          onConfirmar={async (motivo) => {
            await matrizService.devolver(id, motivo);
            despuesDeCambiar("Devuelto a preparación.");
          }}
        />
      )}
      <ConfirmDialog
        isOpen={ventana === "enviar"}
        title="Enviar a validación"
        message="El período pasará a «Pendiente de validación» y quien valida podrá cerrarlo o devolverlo."
        confirmLabel="Enviar"
        isLoading={isConfirmando}
        onConfirm={() => confirmar("enviar")}
        onCancel={() => setVentana(null)}
      />
      <ConfirmDialog
        isOpen={ventana === "validar"}
        title="Validar y finalizar"
        message="El período queda cerrado con su evidencia y deja de recibir recordatorios. No se puede reabrir."
        confirmLabel="Validar y finalizar"
        isLoading={isConfirmando}
        onConfirm={() => confirmar("validar")}
        onCancel={() => setVentana(null)}
      />
      <ConfirmDialog
        isOpen={ventana === "recordar"}
        title="Reenviar recordatorio"
        message="Se envía ahora un recordatorio al responsable (y al suplente, si la empresa lo pide), aunque ya se haya enviado otro hoy."
        confirmLabel="Enviar"
        isLoading={isConfirmando}
        onConfirm={() => confirmar("recordar")}
        onCancel={() => setVentana(null)}
      />
    </div>
  );
}
