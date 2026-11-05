/*
 * La ficha de un proyecto (`ProjectDetailView` de Nexo) con sus pestañas:
 * Resumen, Fases, Participantes, Actividades, Comentarios, Documentos e
 * Historial. Qué puede hacer la persona lo dice el servidor en el detalle
 * (`can_manage`: editar, estado, fases y participantes; `can_participate`:
 * comentar, registrar actividades y subir documentos; `can_delete`: enviar a
 * la papelera) y lo vuelve a revisar en cada petición.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import {
  errorDeProyectos,
  proyectosGhService,
} from "../../../api/proyectosGhService";
import { confirmar } from "../../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../../components/common/Pestanas/Pestanas";
import { Aviso, ErrorEnLinea, MenuDeAcciones, fechaHora } from "../comunes";
import { PillPrioridad } from "../Tareas/Indicadores";
import { fechaCorta, haceCuanto, horas, hoy } from "../Tareas/tareasComunes";
import { Actividades } from "./Actividades";
import { Comentarios, Historial } from "./ComentariosEHistorial";
import { ConAccesoProyectos, useProyectos } from "./ContextoProyectos";
import { Documentos } from "./Documentos";
import { Fases } from "./Fases";
import { FormularioProyecto } from "./FormularioProyecto";
import { Participantes } from "./Participantes";
import { PillEstadoProyecto, RUTA_PROYECTOS } from "./Proyectos";
import {
  ESTADO_PROYECTO,
  ESTADOS_PROYECTO,
  avance,
  nombreDe,
  porcentajeEjecutado,
  proximoVencimiento,
} from "./proyectosComunes";

const PESTANAS = [
  "resumen",
  "fases",
  "participantes",
  "actividades",
  "comentarios",
  "documentos",
  "historial",
];

export function DetalleProyecto() {
  return (
    <ConAccesoProyectos titulo="Proyecto">
      <PantallaDetalle />
    </ConAccesoProyectos>
  );
}

function PantallaDetalle() {
  const { proyectoId } = useParams();
  const id = Number(proyectoId);
  const { usuarioId } = useProyectos();
  const navigate = useNavigate();
  const location = useLocation();
  const [parametros, setParametros] = useSearchParams();
  const pestana = PESTANAS.includes(parametros.get("pestana"))
    ? parametros.get("pestana")
    : "resumen";
  const [proyecto, setProyecto] = useState(null);
  const [error, setError] = useState(null);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [aviso, setAviso] = useState(location.state?.aviso ?? null);
  const [editando, setEditando] = useState(false);
  const titulo = useRef(null);
  const enviando = useRef(false);

  const cargar = useCallback(() => {
    setError(null);
    setNoEncontrado(false);
    proyectosGhService
      .obtener(id)
      .then(setProyecto)
      .catch((err) => {
        const e = errorDeProyectos(err, "No se pudo cargar el proyecto.");
        if (e.estado === 404) setNoEncontrado(true);
        else setError(e.mensaje);
      });
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Al llegar, el foco va al título: quien usa lector de pantalla sabe dónde
  // quedó (y no en el enlace de la tarjeta que ya no existe).
  const cargado = Boolean(proyecto);
  useEffect(() => {
    if (cargado) titulo.current?.focus();
  }, [cargado]);

  const cambiarPestana = (valor) =>
    setParametros(valor === "resumen" ? {} : { pestana: valor }, {
      replace: true,
    });

  /** Lo que cambia en una pestaña se refleja en la ficha (y sus cuentas). */
  const actualizar = (cambio) =>
    setProyecto((p) => (typeof cambio === "function" ? cambio(p) : cambio));

  async function enviarAPapelera() {
    if (enviando.current) return;
    const seguir = await confirmar({
      titulo: `¿Enviar «${proyecto.name}» a la papelera?`,
      mensaje:
        "Deja de verse en el listado. Se puede restaurar desde la papelera durante el período de retención; después se elimina para siempre.",
      accion: "Enviar a la papelera",
    });
    if (!seguir) return;
    enviando.current = true;
    try {
      await proyectosGhService.enviarAPapelera(proyecto.id);
      navigate(RUTA_PROYECTOS, {
        state: {
          aviso: { texto: `«${proyecto.name}» se envió a la papelera.` },
        },
      });
    } catch (err) {
      setAviso({
        tono: "bad",
        texto: errorDeProyectos(err, "No se pudo enviar a la papelera.")
          .mensaje,
      });
      enviando.current = false;
    }
  }

  const volver = (
    <div>
      <Link
        to={RUTA_PROYECTOS}
        state={{ desde: id }}
        className="btn btn-link px-0"
      >
        <Icon name="arrow-left" /> Volver a Proyectos
      </Link>
    </div>
  );

  if (!proyecto) {
    return (
      <div className="gh-page">
        {volver}
        {noEncontrado ? (
          <div className="mz-alert mz-alert--warn" role="alert">
            <Icon name="exclamation-triangle" />
            <span>
              No se encontró el proyecto: es posible que ya no exista, que esté
              en la papelera o que no tenga acceso a él.
            </span>
          </div>
        ) : (
          <EstadoDeCarga
            cargando={!error}
            error={error}
            onReintentar={cargar}
          />
        )}
      </div>
    );
  }

  const opciones = [
    { id: "resumen", etiqueta: "Resumen" },
    {
      id: "fases",
      etiqueta: "Fases",
      cuenta: proyecto.phases?.length,
      unidad: "fases",
    },
    {
      id: "participantes",
      etiqueta: "Participantes",
      cuenta: proyecto.participants?.length,
      unidad: "participantes",
    },
    {
      id: "actividades",
      etiqueta: "Actividades",
      cuenta: proyecto.activity_count,
      unidad: "actividades",
    },
    {
      id: "comentarios",
      etiqueta: "Comentarios",
      cuenta: proyecto.comment_count,
      unidad: "comentarios",
    },
    {
      id: "documentos",
      etiqueta: "Documentos",
      cuenta: proyecto.document_count,
      unidad: "documentos",
    },
    { id: "historial", etiqueta: "Historial" },
  ];

  return (
    <div className="gh-page">
      {volver}
      <div className="mz-view-head">
        <div className="gt-min0">
          <h2 ref={titulo} tabIndex={-1} className="gp-titulo">
            {proyecto.name}
          </h2>
          <p className="mz-desc mb-1">
            <PillEstadoProyecto estado={proyecto.status} />{" "}
            <PillPrioridad prioridad={proyecto.priority} /> · Responsable:{" "}
            <strong>{nombreDe(proyecto.responsible)}</strong>
          </p>
          {proyecto.description && (
            <p className="mz-desc gh-pre mb-0">{proyecto.description}</p>
          )}
        </div>
        {(proyecto.can_manage || proyecto.can_delete) && (
          <div className="mz-view-actions">
            {proyecto.can_manage && (
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={() => setEditando(true)}
              >
                <Icon name="pencil" /> Editar
              </button>
            )}
            {proyecto.can_delete && (
              <MenuDeAcciones
                etiqueta={`Más acciones de «${proyecto.name}»`}
                acciones={[
                  {
                    texto: "Enviar a la papelera",
                    onClick: enviarAPapelera,
                    peligro: true,
                  },
                ]}
              />
            )}
          </div>
        )}
      </div>

      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      <Pestanas
        etiqueta="Secciones del proyecto"
        idBase="gp-ficha"
        valor={pestana}
        onCambio={cambiarPestana}
        opciones={opciones}
      />
      <PanelDePestana idBase="gp-ficha" valor={pestana}>
        {pestana === "resumen" && (
          <Resumen proyecto={proyecto} onActualizado={actualizar} />
        )}
        {pestana === "fases" && (
          <Fases proyecto={proyecto} onActualizado={actualizar} />
        )}
        {pestana === "participantes" && (
          <Participantes proyecto={proyecto} onActualizado={actualizar} />
        )}
        {pestana === "actividades" && (
          <Actividades
            proyecto={proyecto}
            usuarioId={usuarioId}
            onRegistrada={cargar}
          />
        )}
        {pestana === "comentarios" && (
          <Comentarios
            proyecto={proyecto}
            onComentado={() =>
              actualizar((p) => ({
                ...p,
                comment_count: (p.comment_count ?? 0) + 1,
              }))
            }
          />
        )}
        {pestana === "documentos" && (
          <Documentos
            proyecto={proyecto}
            onSubido={() =>
              actualizar((p) => ({
                ...p,
                document_count: (p.document_count ?? 0) + 1,
              }))
            }
          />
        )}
        {pestana === "historial" && <Historial proyecto={proyecto} />}
      </PanelDePestana>

      {editando && (
        <FormularioProyecto
          proyecto={proyecto}
          usuarioId={usuarioId}
          onCerrar={() => setEditando(false)}
          onGuardado={(guardado) => {
            setEditando(false);
            setProyecto(guardado);
            setAviso({ texto: "Cambios guardados." });
          }}
        />
      )}
    </div>
  );
}

function Indicador({ etiqueta, valor, sub }) {
  return (
    <div className="mz-kpi">
      <div className="mz-kpi-top">
        <span className="mz-kpi-label">{etiqueta}</span>
      </div>
      <div className="mz-kpi-value gp-kpi-valor">{valor}</div>
      {sub && <div className="mz-kpi-sub">{sub}</div>}
    </div>
  );
}

/** La pestaña Resumen: tarjetas de indicadores, el detalle, las
 * observaciones y el estado (Nexo, Sprint 2.1 §10). */
function Resumen({ proyecto, onActualizado }) {
  const pct = porcentajeEjecutado(proyecto);
  const vence = proximoVencimiento(proyecto, hoy());
  const [observaciones, setObservaciones] = useState(
    proyecto.observations ?? "",
  );
  const [editandoObs, setEditandoObs] = useState(false);
  const [estado, setEstado] = useState(proyecto.status);
  const [guardando, setGuardando] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);
  const enCurso = useRef(false);
  const botonEditarObs = useRef(null);

  useEffect(() => {
    setEstado(proyecto.status);
  }, [proyecto.status]);

  async function guardar(cambios, que) {
    if (enCurso.current) return false;
    enCurso.current = true;
    setGuardando(que);
    setError(null);
    setMensaje(null);
    try {
      const guardado = await proyectosGhService.actualizar(
        proyecto.id,
        cambios,
      );
      onActualizado(guardado);
      setMensaje(
        que === "estado"
          ? `Estado cambiado a ${ESTADO_PROYECTO[guardado.status]}.`
          : "Observaciones guardadas.",
      );
      return true;
    } catch (err) {
      setError(errorDeProyectos(err, "No se pudo guardar.").mensaje);
      return false;
    } finally {
      enCurso.current = false;
      setGuardando(null);
    }
  }

  return (
    <div className="mz-stack">
      <div className="mz-kpi-grid">
        <Indicador
          etiqueta="Estado"
          valor={<PillEstadoProyecto estado={proyecto.status} />}
        />
        <Indicador
          etiqueta="Avance"
          valor={`${avance(proyecto)} %`}
          sub={
            proyecto.phases?.length
              ? "Promedio de las fases"
              : "Por tiempo ejecutado"
          }
        />
        <Indicador
          etiqueta="Participantes"
          valor={proyecto.participants?.length ?? 0}
        />
        <Indicador
          etiqueta="Tiempo objetivo"
          valor={horas(proyecto.target_time_hours)}
        />
        <Indicador
          etiqueta="Tiempo registrado"
          valor={horas(proyecto.real_hours)}
          sub={`${pct} % del objetivo`}
        />
        <Indicador etiqueta="Fases" valor={proyecto.phases?.length ?? 0} />
        <Indicador
          etiqueta="Última actividad"
          valor={
            proyecto.last_activity
              ? haceCuanto(proyecto.last_activity.created_at)
              : "Sin actividad"
          }
          sub={proyecto.last_activity?.author_name}
        />
        <Indicador
          etiqueta="Próximo vencimiento"
          valor={vence ? fechaCorta(vence) : "Sin fecha próxima"}
        />
      </div>

      <div role="status" className="visually-hidden">
        {mensaje}
      </div>
      {mensaje && (
        <div className="mz-alert mz-alert--ok" aria-hidden="true">
          <Icon name="check2-circle" />
          <span>{mensaje}</span>
        </div>
      )}
      <ErrorEnLinea mensaje={error} />

      <div className="mz-grid-2">
        <div className="mz-stack">
          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Detalle</h3>
            </div>
            <div className="mz-card-body">
              <div className="mz-kv-grid">
                <div className="mz-kv">
                  <span className="mz-kv-label">Área</span>
                  {proyecto.area || "—"}
                </div>
                <div className="mz-kv">
                  <span className="mz-kv-label">Creado por</span>
                  {nombreDe(proyecto.created_by)}
                </div>
                <div className="mz-kv">
                  <span className="mz-kv-label">Fecha de inicio</span>
                  {fechaCorta(proyecto.start_date)}
                </div>
                <div className="mz-kv">
                  <span className="mz-kv-label">Fecha objetivo</span>
                  {fechaCorta(proyecto.target_date)}
                </div>
                {proyecto.completed_at && (
                  <div className="mz-kv">
                    <span className="mz-kv-label">Completado</span>
                    {fechaHora(proyecto.completed_at)}
                  </div>
                )}
                {proyecto.tags?.length > 0 && (
                  <div className="mz-kv mz-kv--full">
                    <span className="mz-kv-label">Etiquetas</span>
                    <span className="gp-marcas">
                      {proyecto.tags.map((t) => (
                        <span key={t} className="mz-pill mz-pill--info">
                          #{t}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Observaciones</h3>
              {proyecto.can_manage && !editandoObs && (
                <button
                  ref={botonEditarObs}
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => setEditandoObs(true)}
                >
                  Editar observaciones
                </button>
              )}
            </div>
            <div className="mz-card-body">
              {editandoObs ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (
                      await guardar(
                        { observations: observaciones.trim() },
                        "observaciones",
                      )
                    ) {
                      setEditandoObs(false);
                      setTimeout(() => botonEditarObs.current?.focus(), 0);
                    }
                  }}
                >
                  <label className="visually-hidden" htmlFor="gp-obs">
                    Observaciones
                  </label>
                  <textarea
                    id="gp-obs"
                    className="form-control"
                    rows={3}
                    maxLength={5000}
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                  />
                  <div className="mz-actions justify-content-end mt-2">
                    <button
                      type="button"
                      className="btn btn-cancelar btn-sm"
                      onClick={() => {
                        setObservaciones(proyecto.observations ?? "");
                        setEditandoObs(false);
                        setTimeout(() => botonEditarObs.current?.focus(), 0);
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={guardando === "observaciones"}
                    >
                      {guardando === "observaciones"
                        ? "Guardando…"
                        : "Guardar observaciones"}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="gh-pre mb-0">
                  {proyecto.observations || (
                    <span className="mz-faint">Sin observaciones.</span>
                  )}
                </p>
              )}
            </div>
          </section>
        </div>

        {proyecto.can_manage && (
          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Estado del proyecto</h3>
            </div>
            <form
              className="mz-card-body"
              onSubmit={(e) => {
                e.preventDefault();
                if (estado !== proyecto.status)
                  guardar({ status: estado }, "estado");
              }}
            >
              <label className="form-label" htmlFor="gp-estado">
                Estado
              </label>
              <select
                id="gp-estado"
                className="form-select"
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
              >
                {ESTADOS_PROYECTO.map((e) => (
                  <option key={e} value={e}>
                    {ESTADO_PROYECTO[e]}
                  </option>
                ))}
              </select>
              <p className="form-text">
                El proyecto sigue activo entre meses: solo Completado o
                Cancelado detienen la acumulación de horas.
              </p>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={estado === proyecto.status || guardando === "estado"}
              >
                {guardando === "estado" ? "Guardando…" : "Cambiar estado"}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
