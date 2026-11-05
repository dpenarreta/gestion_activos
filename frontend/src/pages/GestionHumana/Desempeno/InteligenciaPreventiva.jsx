/*
 * Inteligencia preventiva (`PreventiveIntelligenceModule` de Nexo):
 * tendencias, predicciones explicables y alertas preventivas calculadas solo
 * con el histórico de la persona en la intranet, sin inteligencia
 * artificial generativa. Su actividad (si ejecuta tareas) y, con
 * `kpi.equipo`, la de su equipo: subutilización, retraso de proyectos y
 * alertas. El simulador de escenarios nunca guarda nada.
 */
import { useRef, useState } from "react";

import {
  errorDeProyectos,
  proyectosGhService,
} from "../../../api/proyectosGhService";
import { errorDeKpi, kpiService } from "../../../api/kpiService";
import {
  Campo,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { KPI_EQUIPO, RIESGO_VER } from "../../../modulos/permisosGestionHumana";
import { ErrorEnLinea } from "../comunes";
import { Encabezado } from "../Tareas/ContextoTareas";
import { PreviaHoras } from "../Tareas/Indicadores";
import { AYUDA_HORAS } from "../Tareas/tareasComunes";
import { SinDatos } from "./AnalisisAvanzado";
import { EstadoSeccion, Seccion, Semaforo } from "./Componentes";
import { ConAccesoKpi, useCarga, useKpi } from "./ContextoKpi";
import { LineaDePuntaje } from "./Graficos";
import {
  ResultadoDeSimulacion,
  resumenDeSimulacion,
  valorDe,
} from "./Simulador";
import {
  CONFIABILIDAD,
  DIRECCION,
  ESTABILIDAD_TONO,
  INDICADOR_TENDENCIA,
  SEVERIDAD_PREVENTIVA,
  TONO_NIVEL,
  conSigno,
  numero,
  porcentaje,
} from "./kpiComunes";

export function InteligenciaPreventiva() {
  return (
    <ConAccesoKpi titulo="Inteligencia preventiva" permiso={RIESGO_VER}>
      <PantallaPreventiva />
    </ConAccesoKpi>
  );
}

function PantallaPreventiva() {
  const { usuarioId, can, esDireccion } = useKpi();
  const individual = !esDireccion;
  const equipo = can(KPI_EQUIPO);
  return (
    <div className="gh-page">
      <Encabezado
        titulo="Inteligencia preventiva"
        descripcion="Tendencias, predicciones y alertas preventivas basadas solo en el histórico registrado en la intranet, sin inteligencia artificial generativa."
      />
      {individual && <SuActividad usuarioId={usuarioId} equipo={equipo} />}
      {equipo && (
        <section className="mz-stack" aria-labelledby="gk-ip-equipo">
          <h3 id="gk-ip-equipo" className="gk-titulo-seccion">
            Su equipo
          </h3>
          <div className="mz-grid-2 mz-grid-2--even">
            <Subutilizacion />
            <RetrasoDeProyectos />
          </div>
          <Alertas
            titulo="Alertas preventivas del equipo"
            pedir={() => kpiService.alertasDelEquipo()}
          />
          {!individual && (
            <SimuladorDeEscenarios usuarioId={usuarioId} equipo />
          )}
        </section>
      )}
      {!individual && !equipo && (
        <p className="mz-empty mb-0">
          Su rol es de dirección: no tiene actividad individual que proyectar, y
          para ver la de su equipo necesita el permiso de KPI del equipo.
        </p>
      )}
    </div>
  );
}

function SuActividad({ usuarioId, equipo }) {
  const predicciones = useCarga(
    () => kpiService.predicciones(usuarioId),
    [usuarioId],
    "No se pudieron cargar las predicciones.",
  );
  return (
    <section className="mz-stack" aria-labelledby="gk-ip-propia">
      <h3 id="gk-ip-propia" className="gk-titulo-seccion">
        Su actividad
      </h3>
      <ResumenDeTendencias usuarioId={usuarioId} />
      <div className="mz-grid-2">
        <Predicciones carga={predicciones} />
        <div className="mz-stack">
          <Estabilidad carga={predicciones} />
          <Alertas
            titulo="Alertas preventivas"
            pedir={() => kpiService.alertasPreventivas(usuarioId)}
            dependencias={[usuarioId]}
          />
        </div>
      </div>
      <TendenciasHistoricas usuarioId={usuarioId} />
      <SimuladorDeEscenarios
        usuarioId={usuarioId}
        equipo={equipo}
        tareas={(predicciones.datos?.task_delays ?? []).map((t) => ({
          id: t.task_id,
          titulo: t.title,
        }))}
      />
    </section>
  );
}

function Direccion({ direccion }) {
  const d = DIRECCION[direccion] ?? DIRECCION.estable;
  return <Semaforo tono={d.tono}>Tendencia {d.texto.toLowerCase()}</Semaforo>;
}

function ResumenDeTendencias({ usuarioId }) {
  const carga = useCarga(
    () => kpiService.tendencias(usuarioId),
    [usuarioId],
    "No se pudieron cargar las tendencias.",
  );
  const d = carga.datos;
  return (
    <Seccion titulo="Tendencias">
      {!d ? (
        <EstadoSeccion carga={carga} />
      ) : (
        <>
          <p className="mz-small mz-faint">
            Histórico analizado: {d.window_weeks}{" "}
            {d.window_weeks === 1 ? "semana" : "semanas"}.
          </p>
          <ul className="gk-indicadores">
            {Object.values(d.indicators).map((ind) => (
              <li key={ind.indicator} className="gh-recuadro">
                <p className="mz-strong mb-1">
                  {INDICADOR_TENDENCIA[ind.indicator]?.nombre ?? ind.label}
                </p>
                {ind.available ? (
                  <>
                    <Direccion direccion={ind.direction} />
                    <p className="mz-small mb-0 mt-1">
                      Último valor:{" "}
                      <strong>
                        {ind.data_points?.length
                          ? `${numero(
                              ind.data_points[ind.data_points.length - 1].value,
                            )}${INDICADOR_TENDENCIA[ind.indicator]?.unidad ?? ""}`
                          : "—"}
                      </strong>
                    </p>
                    <p className="mz-small mz-faint mb-0">
                      Variabilidad (cuánto cambia semana a semana):{" "}
                      {numero(ind.coefficient_of_variation)} %
                    </p>
                  </>
                ) : (
                  <SinDatos motivo={ind.reason} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Seccion>
  );
}

function Explicacion({ p }) {
  return (
    <div className="mz-small">
      <p className="mb-1">{p.por_que}</p>
      {p.variables_con_mayor_impacto?.length > 0 && (
        <p className="mb-1">
          <span className="mz-faint">Variables con mayor impacto: </span>
          {p.variables_con_mayor_impacto.join(", ")}
        </p>
      )}
      {p.datos_utilizados?.length > 0 && (
        <p className="mb-1">
          <span className="mz-faint">Datos utilizados: </span>
          {p.datos_utilizados.join("; ")}
        </p>
      )}
      {p.que_hacer?.length > 0 && (
        <>
          <p className="mz-faint mb-0">Qué hacer:</p>
          <ul className="mb-0">
            {p.que_hacer.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Confiabilidad({ p }) {
  return (
    <p className="mz-small mz-faint mb-1">
      Confianza: {porcentaje(p.confidence_pct)} · Confiabilidad del histórico:{" "}
      {CONFIABILIDAD[p.historical_reliability] ?? p.historical_reliability} ·{" "}
      {p.historical_window_weeks} semanas de histórico · horizonte de{" "}
      {p.horizon} días
    </p>
  );
}

function Predicciones({ carga }) {
  const d = carga.datos;
  if (!d) {
    return (
      <Seccion titulo="Predicciones">
        <EstadoSeccion carga={carga} />
      </Seccion>
    );
  }
  const { cumplimiento: c, sobrecarga: s, task_delays: retrasos = [] } = d;
  return (
    <div className="mz-stack">
      <Seccion titulo="Proyección de cumplimiento">
        {c.available ? (
          <>
            <p className="mb-1">
              <strong className="gk-grande">
                {porcentaje(c.cumplimiento_esperado_cierre_pct)}
              </strong>{" "}
              al cierre del mes · variación esperada{" "}
              {conSigno(c.variacion_esperada_pct)} %
            </p>
            <p className="mb-1">{c.que_ocurrira}</p>
            <Confiabilidad p={c} />
            <Explicacion p={c} />
          </>
        ) : (
          <p className="mz-faint mb-0">{c.reason}</p>
        )}
      </Seccion>
      <Seccion titulo="Predicción de sobrecarga">
        {s.available ? (
          <>
            <p className="mb-1">
              <strong className="gk-grande">
                {porcentaje(s.probabilidad_pct)}
              </strong>{" "}
              <Semaforo tono={TONO_NIVEL[s.nivel] ?? "neutral"}>
                Nivel {s.nivel.toLowerCase()}
              </Semaforo>
            </p>
            <p className="mb-1">{s.que_ocurrira}</p>
            <Confiabilidad p={s} />
            <Explicacion p={s} />
          </>
        ) : (
          <p className="mz-faint mb-0">{s.reason}</p>
        )}
      </Seccion>
      {retrasos.length > 0 && (
        <Seccion titulo="Predicción de retrasos: sus tareas abiertas">
          <ul className="gk-lista">
            {retrasos.map(({ task_id: id, title, prediction: p }) => (
              <li key={id} className="gk-fila">
                <div className="gt-min0 flex-grow-1">
                  <p className="mb-0">{title}</p>
                  {p.available && p.motivos?.length > 0 && (
                    <p className="mz-small mz-faint mb-0">
                      Motivos: {p.motivos.join(", ")}
                    </p>
                  )}
                </div>
                {p.available ? (
                  <span>
                    <Semaforo tono={TONO_NIVEL[p.nivel] ?? "neutral"}>
                      {p.nivel}: {porcentaje(p.probabilidad_pct)}
                    </Semaforo>
                  </span>
                ) : (
                  <span className="mz-small mz-faint">{p.reason}</span>
                )}
              </li>
            ))}
          </ul>
        </Seccion>
      )}
    </div>
  );
}

function Estabilidad({ carga }) {
  const e = carga.datos?.estabilidad;
  if (!e) return null;
  // Sin ninguna serie con variabilidad medida, «Muy Alta» no dice nada:
  // es falta de datos (pendiente de backend: que lo marque él).
  if (!e.based_on?.length && !e.average_coefficient_of_variation) {
    return (
      <Seccion titulo="Estabilidad operativa">
        <SinDatos motivo="Todavía no hay semanas con actividad suficiente para medir la estabilidad." />
      </Seccion>
    );
  }
  return (
    <Seccion titulo="Estabilidad operativa">
      <p className="mb-1">
        <Semaforo tono={ESTABILIDAD_TONO[e.classification] ?? "neutral"}>
          {e.classification}
        </Semaforo>
      </p>
      <p className="mz-small mb-1">
        Variabilidad promedio (cuánto cambia semana a semana):{" "}
        {numero(e.average_coefficient_of_variation)} %
      </p>
      {e.based_on?.length > 0 && (
        <p className="mz-small mz-faint mb-0">
          Mayor variabilidad en: {e.based_on.join(", ")}
        </p>
      )}
    </Seccion>
  );
}

function Alertas({ titulo, pedir, dependencias = [] }) {
  const carga = useCarga(
    pedir,
    dependencias,
    "No se pudieron cargar las alertas preventivas.",
  );
  const alertas = carga.datos?.alerts;
  return (
    <Seccion titulo={titulo}>
      {!alertas ? (
        <EstadoSeccion carga={carga} />
      ) : alertas.length === 0 ? (
        <Semaforo tono="ok">Sin alertas preventivas</Semaforo>
      ) : (
        <ul className="gk-lista">
          {alertas.map((a, i) => {
            const s =
              SEVERIDAD_PREVENTIVA[a.severity] ?? SEVERIDAD_PREVENTIVA.amarilla;
            return (
              <li
                key={`${a.message}-${i}`}
                className={`gk-alerta gk-alerta--${s.tono}`}
              >
                <p className="mb-1">
                  <Semaforo tono={s.tono}>{s.texto}</Semaforo>{" "}
                  <span className="mz-small mz-faint">{a.source}</span>
                </p>
                <p className="mb-0">{a.message}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Seccion>
  );
}

const VENTANAS = [
  [3, "3 semanas"],
  [4, "4 semanas"],
  [8, "8 semanas"],
  [13, "3 meses"],
  [26, "6 meses"],
  [52, "1 año"],
];

const INDICADORES = Object.entries(INDICADOR_TENDENCIA).map(([k, v]) => [
  k,
  v.nombre,
]);

function TendenciasHistoricas({ usuarioId }) {
  const [semanas, setSemanas] = useState(3);
  const [indicador, setIndicador] = useState("cumplimiento");
  const carga = useCarga(
    () => kpiService.tendencias(usuarioId, semanas),
    [usuarioId, semanas],
    "No se pudieron cargar las tendencias.",
  );
  const elegido = carga.datos?.indicators?.[indicador];
  const nombre = INDICADORES.find(([k]) => k === indicador)?.[1];
  const puntos = (elegido?.data_points ?? []).map((p) => ({
    etiqueta: p.label,
    valor: p.value,
  }));
  return (
    <Seccion
      titulo="Tendencias históricas"
      accion={
        <div className="gk-filtros">
          <label className="visually-hidden" htmlFor="gk-ip-indicador">
            Indicador
          </label>
          <select
            id="gk-ip-indicador"
            className="form-select form-select-sm"
            value={indicador}
            onChange={(e) => setIndicador(e.target.value)}
          >
            {INDICADORES.map(([k, t]) => (
              <option key={k} value={k}>
                {t}
              </option>
            ))}
          </select>
          <label className="visually-hidden" htmlFor="gk-ip-ventana">
            Período
          </label>
          <select
            id="gk-ip-ventana"
            className="form-select form-select-sm"
            value={semanas}
            onChange={(e) => setSemanas(Number(e.target.value))}
          >
            {VENTANAS.map(([n, t]) => (
              <option key={n} value={n}>
                {t}
              </option>
            ))}
          </select>
        </div>
      }
    >
      {!carga.datos ? (
        <EstadoSeccion carga={carga} />
      ) : !elegido?.available || puntos.length === 0 ? (
        <p className="mz-faint mb-0">
          {elegido?.reason ?? "Sin historial suficiente en este período."}
        </p>
      ) : (
        <>
          <p className="mb-2">
            <Direccion direccion={elegido.direction} />
          </p>
          <LineaDePuntaje
            datos={puntos}
            nombre={nombre}
            dominio={["auto", "auto"]}
            unidad={INDICADOR_TENDENCIA[indicador]?.unidad ?? ""}
          />
        </>
      )}
    </Seccion>
  );
}

function Subutilizacion() {
  const carga = useCarga(
    () => kpiService.subutilizacionDelEquipo(),
    [],
    "No se pudo cargar la predicción de subutilización.",
  );
  const miembros = carga.datos?.members;
  return (
    <Seccion titulo="Predicción de subutilización del equipo">
      {!miembros ? (
        <EstadoSeccion carga={carga} />
      ) : miembros.length === 0 ? (
        <p className="mz-faint mb-0">Sin personas para evaluar.</p>
      ) : (
        <ul className="gk-lista">
          {miembros.map((m) => (
            <li key={m.user_id} className="gk-fila">
              <span className="flex-grow-1">{m.name}</span>
              {m.prediction ? (
                <span>
                  <Semaforo tono={TONO_NIVEL[m.prediction.nivel] ?? "neutral"}>
                    Nivel {m.prediction.nivel.toLowerCase()}
                  </Semaforo>{" "}
                  <span className="mz-small mz-faint">
                    {porcentaje(m.prediction.confidence_pct)} de confianza
                  </span>
                </span>
              ) : (
                <span className="mz-small mz-faint">Sin datos</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}

const CERRADOS = new Set(["COMPLETADO", "CANCELADO"]);
const MAXIMO_PROYECTOS = 12;

function RetrasoDeProyectos() {
  const carga = useCarga(
    async () => {
      let proyectos;
      try {
        proyectos = await proyectosGhService.listar();
      } catch (err) {
        const e = errorDeProyectos(err);
        if (e.estado === 403) return { sinAcceso: true, filas: [] };
        throw err;
      }
      const todos = (Array.isArray(proyectos) ? proyectos : []).filter(
        (p) => !CERRADOS.has(p.status),
      );
      const activos = todos.slice(0, MAXIMO_PROYECTOS);
      const filas = await Promise.all(
        activos.map(async (p) => {
          try {
            return {
              id: p.id,
              nombre: p.name,
              p: await kpiService.retrasoDeProyecto(p.id),
            };
          } catch {
            return {
              id: p.id,
              nombre: p.name,
              p: { available: false, reason: "No disponible" },
            };
          }
        }),
      );
      return { filas, total: todos.length };
    },
    [],
    "No se pudo cargar la predicción de retrasos de proyectos.",
  );
  const d = carga.datos;
  return (
    <Seccion titulo="Predicción de retrasos: proyectos">
      {!d ? (
        <EstadoSeccion carga={carga} />
      ) : d.sinAcceso ? (
        <p className="mz-faint mb-0">No tiene acceso a Proyectos.</p>
      ) : d.filas.length === 0 ? (
        <p className="mz-faint mb-0">Sin proyectos activos para evaluar.</p>
      ) : (
        <>
          {d.total > d.filas.length && (
            <p className="mz-small mz-faint">
              Se muestran los primeros {d.filas.length} de {d.total} proyectos
              activos.
            </p>
          )}
          <ul className="gk-lista">
            {d.filas.map(({ id, nombre, p }) => (
              <li key={id} className="gk-fila">
                <div className="gt-min0 flex-grow-1">
                  <p className="mb-0">{nombre}</p>
                  {p.available && p.motivos?.length > 0 && (
                    <p className="mz-small mz-faint mb-0">
                      Motivos: {p.motivos.join(", ")}
                    </p>
                  )}
                </div>
                {p.available ? (
                  <Semaforo tono={TONO_NIVEL[p.nivel] ?? "neutral"}>
                    {p.nivel}: {porcentaje(p.probabilidad_pct)}
                  </Semaforo>
                ) : (
                  <span className="mz-small mz-faint">{p.reason}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Seccion>
  );
}

const ESCENARIO = {
  register_hours: "Agregar horas",
  complete_task: "Cerrar tareas",
  adjust_target_time: "Modificar el tiempo objetivo",
  redistribute_load: "Redistribuir carga",
  add_participants: "Agregar participantes a un proyecto",
};

/** Los campos de cada escenario, con la misma convención que el simulador
 * «¿Qué pasaría si…?»: horas en HH.MM, sin valores precargados y con el
 * error en su campo. */
const CAMPOS = {
  register_hours: [
    { clave: "hours", etiqueta: "Horas adicionales (HH.MM)", tipo: "horas" },
  ],
  complete_task: [
    { clave: "count", etiqueta: "Cantidad de tareas", tipo: "numero" },
  ],
  adjust_target_time: [
    {
      clave: "target",
      etiqueta: "Nuevo tiempo objetivo (HH.MM)",
      tipo: "horas",
    },
  ],
  redistribute_load: [
    { clave: "hours", etiqueta: "Horas a redistribuir (HH.MM)", tipo: "horas" },
  ],
  add_participants: [
    {
      clave: "participants",
      etiqueta: "Participantes a agregar",
      tipo: "numero",
    },
  ],
};

function SimuladorDeEscenarios({ usuarioId, equipo, tareas = [] }) {
  const opciones = equipo
    ? Object.keys(ESCENARIO)
    : ["register_hours", "complete_task", "adjust_target_time"];
  const [escenario, setEscenario] = useState(opciones[0]);
  const [valores, setValores] = useState({});
  const [errores, setErrores] = useState({});
  const [resultado, setResultado] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);
  const [simulando, setSimulando] = useState(false);
  const enCurso = useRef(false);
  const formulario = useRef(null);

  // Las personas y los proyectos se piden solo si se ofrecen esos
  // escenarios; si fallan, se dice (nunca una lista vacía falsa).
  const personas = useCarga(
    () =>
      equipo
        ? kpiService.subutilizacionDelEquipo()
        : Promise.resolve({ members: [] }),
    [equipo],
    "No se pudo cargar a las personas de su equipo.",
  );
  const proyectos = useCarga(
    () => (equipo ? proyectosGhService.listar() : Promise.resolve([])),
    [equipo],
    "No se pudieron cargar los proyectos.",
  );
  const companeros = (personas.datos?.members ?? []).filter(
    (m) => m.user_id !== usuarioId,
  );
  const listaProyectos = Array.isArray(proyectos.datos) ? proyectos.datos : [];
  const cambiar = (campo) => (e) =>
    setValores((v) => ({ ...v, [campo]: e.target.value }));

  async function simular(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const e = {};
    const n = {};
    for (const campo of CAMPOS[escenario]) {
      const r = valorDe(campo, valores[campo.clave]);
      if (r.error) e[campo.clave] = r.error;
      else n[campo.clave] = r.valor;
    }
    if (escenario === "adjust_target_time" && !valores.task)
      e.task = "Elija la tarea.";
    if (escenario === "redistribute_load" && !valores.to)
      e.to = "Elija a quién redistribuir.";
    if (escenario === "add_participants" && !valores.project)
      e.project = "Elija el proyecto.";
    setErrores(e);
    setError(null);
    setMensaje(null);
    if (Object.keys(e).length) {
      enfocarPrimerError(formulario.current);
      return;
    }
    enCurso.current = true;
    setSimulando(true);
    setResultado(null);
    try {
      let r;
      if (escenario === "register_hours")
        r = await kpiService.simular(usuarioId, {
          type: "register_hours",
          hours: n.hours,
        });
      else if (escenario === "complete_task")
        r = await kpiService.simular(usuarioId, {
          type: "complete_task",
          count: n.count,
        });
      else if (escenario === "adjust_target_time")
        r = await kpiService.simularTiempoObjetivo(usuarioId, {
          task_id: Number(valores.task),
          new_target_time_hours: n.target,
        });
      else if (escenario === "redistribute_load")
        r = await kpiService.simularRedistribucion({
          from_user_id: usuarioId,
          to_user_id: Number(valores.to),
          hours: n.hours,
        });
      else
        r = await kpiService.simularParticipantes(Number(valores.project), {
          additional_participants: n.participants,
        });
      setResultado(r);
      setMensaje(resumenDeSimulacion(r.from ? r.from : r));
    } catch (err) {
      const fallo = errorDeKpi(err, "No se pudo simular.");
      setErrores(fallo.campos);
      setError(fallo.mensaje);
    } finally {
      enCurso.current = false;
      setSimulando(false);
    }
  }

  const necesitaPersonas = escenario === "redistribute_load";
  const necesitaProyectos = escenario === "add_participants";

  return (
    <Seccion titulo="Simulador de escenarios">
      <form ref={formulario} className="mz-stack" onSubmit={simular}>
        <p className="mz-small mz-faint mb-0">
          No guarda nada: solo muestra el impacto hipotético.
        </p>
        <div className="gt-form-grid">
          <Campo id="gk-ip-escenario" etiqueta="Escenario">
            <select
              className="form-select"
              value={escenario}
              onChange={(e) => {
                setEscenario(e.target.value);
                setValores({});
                setErrores({});
                setResultado(null);
                setMensaje(null);
                setError(null);
              }}
            >
              {opciones.map((o) => (
                <option key={o} value={o}>
                  {ESCENARIO[o]}
                </option>
              ))}
            </select>
          </Campo>
          {escenario === "adjust_target_time" && (
            <Campo
              id="gk-ip-tarea"
              etiqueta="Tarea"
              obligatorio
              error={errores.task ?? errores.task_id}
              ayuda={
                tareas.length === 0 ? "No tiene tareas abiertas." : undefined
              }
            >
              <select
                className="form-select"
                value={valores.task ?? ""}
                onChange={cambiar("task")}
              >
                <option value="">Elija una tarea</option>
                {tareas.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.titulo}
                  </option>
                ))}
              </select>
            </Campo>
          )}
          {necesitaPersonas &&
            (personas.error ? (
              <EstadoSeccion carga={personas} />
            ) : (
              <Campo
                id="gk-ip-hacia"
                etiqueta="Redistribuir hacia"
                obligatorio
                error={errores.to ?? errores.to_user_id}
              >
                <select
                  className="form-select"
                  value={valores.to ?? ""}
                  onChange={cambiar("to")}
                  disabled={personas.cargando}
                >
                  <option value="">
                    {personas.cargando
                      ? "Cargando…"
                      : companeros.length
                        ? "Elija una persona"
                        : "Sin compañeros de equipo"}
                  </option>
                  {companeros.map((m) => (
                    <option key={m.user_id} value={String(m.user_id)}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Campo>
            ))}
          {necesitaProyectos &&
            (proyectos.error ? (
              <EstadoSeccion carga={proyectos} />
            ) : (
              <Campo
                id="gk-ip-proyecto"
                etiqueta="Proyecto"
                obligatorio
                error={errores.project}
              >
                <select
                  className="form-select"
                  value={valores.project ?? ""}
                  onChange={cambiar("project")}
                  disabled={proyectos.cargando}
                >
                  <option value="">
                    {proyectos.cargando
                      ? "Cargando…"
                      : listaProyectos.length
                        ? "Elija un proyecto"
                        : "Sin proyectos visibles"}
                  </option>
                  {listaProyectos.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Campo>
            ))}
          {CAMPOS[escenario].map((campo) => (
            <div key={`${escenario}-${campo.clave}`}>
              <Campo
                id={`gk-ip-${campo.clave}`}
                etiqueta={campo.etiqueta}
                obligatorio
                error={
                  errores[campo.clave] ??
                  errores.new_target_time_hours ??
                  errores.additional_participants
                }
                ayuda={campo.tipo === "horas" ? AYUDA_HORAS : undefined}
              >
                <input
                  className="form-control"
                  inputMode="decimal"
                  value={valores[campo.clave] ?? ""}
                  onChange={cambiar(campo.clave)}
                />
              </Campo>
              {campo.tipo === "horas" && (
                <PreviaHoras texto={valores[campo.clave]} />
              )}
            </div>
          ))}
        </div>
        <ErrorEnLinea mensaje={error} />
        <div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={simulando}
          >
            {simulando ? "Simulando…" : "Simular impacto"}
          </button>
        </div>
        <p role="status" className="visually-hidden">
          {mensaje}
        </p>
        {resultado &&
          (resultado.from && resultado.to ? (
            <>
              <h4 className="gk-subtitulo">Usted (origen)</h4>
              <ResultadoDeSimulacion
                antes={resultado.from.before}
                despues={resultado.from.after}
              />
              <h4 className="gk-subtitulo mt-2">Destino</h4>
              <ResultadoDeSimulacion
                antes={resultado.to.before}
                despues={resultado.to.after}
              />
            </>
          ) : (
            <ResultadoDeSimulacion
              antes={resultado.before}
              despues={resultado.after}
            />
          ))}
      </form>
    </Seccion>
  );
}
