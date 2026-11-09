/*
 * KPI del equipo (`KpisModule` de Nexo, pestaña «Equipo»): el balance de
 * carga y la capacidad para asumir tareas del equipo ejecutor, el Índice de
 * Riesgo Operativo del equipo y sus recomendaciones de redistribución (con
 * `inteligencia_preventiva.ver`) y, al elegir a una persona, sus KPI del mes.
 *
 * Es el destino del aviso «Riesgo operativo» de la campana
 * (`/admin/gestion-humana/kpi`): quien solo tiene
 * `inteligencia_preventiva.ver` ve el riesgo del equipo; con `kpi.equipo`, todo.
 * Quién es de su equipo lo decide el organigrama en el servidor.
 *
 * El «Análisis de Nova» (IA) de cada persona va en `DetalleKpi`, con
 * `nova.analisis_kpi`. Fuera de alcance: los Informes mensuales de Nexo (su
 * backend no se portó).
 */
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { kpiService } from "../../../api/kpiService";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  KPI_EQUIPO,
  RIESGO_VER,
  RUTA_GESTION_HUMANA,
} from "../../../modulos/permisosGestionHumana";
import { Encabezado } from "../Tareas/ContextoTareas";
import { iniciales, rolLegible } from "../Tareas/tareasComunes";
import { BotonExcel, EstadoSeccion, Seccion, Semaforo } from "./Componentes";
import { ConAccesoKpi, useCarga, useKpi } from "./ContextoKpi";
import { DetalleKpi } from "./DetalleKpi";
import { RecomendacionesDelEquipo, RiesgoDelEquipo } from "./RiesgoOperativo";
import { ESCENARIOS_DE_CAPACIDAD, Simulador } from "./Simulador";
import {
  CAPACIDAD_TONO,
  CUMPLIMIENTO_CORTO,
  CUMPLIMIENTO_TEXTO,
  horas,
  horasConSigno,
  mesActual,
  nombreDelMes,
  numero,
  porcentaje,
  sumarMeses,
  tonoDe,
} from "./kpiComunes";

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export function KpiEquipo() {
  return (
    <ConAccesoKpi titulo="KPI del equipo" permiso={[KPI_EQUIPO, RIESGO_VER]}>
      <PantallaEquipo />
    </ConAccesoKpi>
  );
}

function PantallaEquipo() {
  const { can, esDireccion } = useKpi();
  const veEquipo = can(KPI_EQUIPO);
  const veRiesgo = can(RIESGO_VER);
  const [parametros, setParametros] = useSearchParams();
  const personaId = Number(parametros.get("persona")) || null;
  const [mes, setMes] = useState(mesActual());

  const elegir = (id) =>
    setParametros(id ? { persona: String(id) } : {}, { replace: false });

  return (
    <div className="gh-page">
      <Encabezado
        titulo="KPI del equipo"
        descripcion="El desempeño, la carga y la capacidad de las personas de su equipo según el organigrama."
      >
        {!esDireccion && (
          <Link
            to={`${RUTA_GESTION_HUMANA}/mis-kpi`}
            className="btn btn-outline-secondary"
          >
            <Icon name="person" /> Ver mi desempeño
          </Link>
        )}
      </Encabezado>
      {veEquipo ? (
        <Equipo
          mes={mes}
          personaId={personaId}
          onElegir={elegir}
          veRiesgo={veRiesgo}
          selectorDeMes={
            <div className="gk-barra">
              <div className="gk-mes">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => setMes((m) => sumarMeses(m, -1))}
                  aria-label="Mes anterior"
                  title="Mes anterior"
                >
                  <Icon name="chevron-left" />
                </button>
                <label className="visually-hidden" htmlFor="gk-mes-equipo">
                  Mes
                </label>
                <input
                  id="gk-mes-equipo"
                  type="month"
                  className="form-control form-control-sm"
                  value={mes}
                  max={mesActual()}
                  onChange={(e) =>
                    MES.test(e.target.value) && setMes(e.target.value)
                  }
                />
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => setMes((m) => sumarMeses(m, 1))}
                  disabled={mes >= mesActual()}
                  aria-label="Mes siguiente"
                  title="Mes siguiente"
                >
                  <Icon name="chevron-right" />
                </button>
              </div>
              <p className="mb-0" aria-live="polite">
                Período: <strong>{nombreDelMes(mes)}</strong>
              </p>
              {can(KPI_EQUIPO) && (
                <div className="gk-acciones ms-auto">
                  <BotonExcel
                    descargar={() => kpiService.exportarEquipo(mes)}
                  />
                </div>
              )}
            </div>
          }
        />
      ) : (
        <SoloRiesgo />
      )}
    </div>
  );
}

/** Quien solo tiene `inteligencia_preventiva.ver`: el riesgo de su equipo
 * y sus recomendaciones; sin equipo, un solo aviso. */
function SoloRiesgo() {
  const carga = useCarga(
    () => kpiService.riesgoDelEquipo(),
    [],
    "No se pudo cargar el riesgo operativo del equipo.",
  );
  if (carga.datos && carga.datos.members.length === 0) {
    return <SinEquipo />;
  }
  return (
    <>
      <RiesgoDelEquipo carga={carga} />
      {carga.datos && <RecomendacionesDelEquipo />}
    </>
  );
}

function SinEquipo() {
  return (
    <p className="mz-empty mb-0">
      No tiene personas a cargo (según el organigrama). Si cree que es un error,
      pida a Gestión Humana que revise su cargo.
    </p>
  );
}

function Equipo({ mes, personaId, onElegir, veRiesgo, selectorDeMes }) {
  const equipo = useCarga(
    () => kpiService.equipo(mes),
    [mes],
    "No se pudo cargar su equipo.",
  );
  const calidad = useCarga(
    () => kpiService.calidadDelDato("team"),
    [],
    "No se pudo calcular la calidad del dato del equipo.",
  );
  const personas = equipo.datos?.users ?? null;
  const elegida = personas?.find((p) => p.id === personaId) ?? null;
  const enCurso = mes === mesActual();

  if (!personas) return <EstadoSeccion carga={equipo} />;
  if (personas.length === 0) {
    // Fuera del mes en curso se deja el selector para poder volver.
    return (
      <div className="mz-stack">
        {!enCurso && selectorDeMes}
        <SinEquipo />
      </div>
    );
  }

  return (
    <div className="mz-stack">
      {selectorDeMes}
      <p className="mz-small mb-0">
        {personas.length} {personas.length === 1 ? "persona" : "personas"} en
        seguimiento
        {calidad.datos && (
          <>
            {" · "}Calidad del dato del equipo:{" "}
            <Semaforo
              tono={
                calidad.datos.pct >= 90
                  ? "ok"
                  : calidad.datos.pct >= 70
                    ? "warn"
                    : "bad"
              }
            >
              {porcentaje(calidad.datos.pct)}
            </Semaforo>
          </>
        )}
      </p>
      {calidad.error && <EstadoSeccion carga={calidad} />}
      {enCurso ? (
        <>
          <div className="mz-grid-2 mz-grid-2--even">
            <BalanceDeCarga personas={personas} />
            <CapacidadDelEquipo />
          </div>
          {veRiesgo && (
            <>
              <RiesgoDelEquipo onElegir={onElegir} />
              <RecomendacionesDelEquipo />
            </>
          )}
        </>
      ) : (
        <>
          <BalanceDeCarga personas={personas} />
          <div className="mz-alert mz-alert--info" role="note">
            <Icon name="info-circle" />
            <span>
              La capacidad, el riesgo operativo y las recomendaciones son del
              mes en curso; para verlos, vuelva al mes en curso.
            </span>
          </div>
        </>
      )}
      <div className="gk-equipo">
        <Personas personas={personas} elegida={elegida} onElegir={onElegir} />
        <div className="gt-min0">
          {elegida ? (
            <Persona
              persona={elegida}
              mes={mes}
              veRiesgo={veRiesgo}
              enCurso={enCurso}
              onVolver={() => {
                onElegir(null);
                setTimeout(
                  () =>
                    document
                      .getElementById(`gk-persona-${elegida.id}`)
                      ?.focus(),
                  0,
                );
              }}
            />
          ) : (
            <p className="mz-empty mb-0">
              Elija a una persona de la lista para ver sus KPI del mes.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Personas({ personas, elegida, onElegir }) {
  return (
    <section
      className="mz-card gk-personas"
      aria-labelledby="gk-personas-titulo"
    >
      <div className="mz-card-head">
        <h3 id="gk-personas-titulo">Personas</h3>
      </div>
      <ul className="gk-personas__lista">
        {personas.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              id={`gk-persona-${p.id}`}
              className="gk-persona"
              aria-pressed={elegida?.id === p.id}
              onClick={() => onElegir(p.id)}
            >
              <span className="gt-avatar" aria-hidden="true">
                {iniciales(p.name)}
              </span>
              <span className="gt-min0 flex-grow-1 text-start">
                <span className="mz-strong d-block gt-corta">{p.name}</span>
                <span className="mz-small mz-faint d-block">
                  {rolLegible(p.role) || "Sin rol de Gestión Humana"}
                </span>
              </span>
              <span className="text-end">
                <span className="mz-strong d-block">
                  <span className="visually-hidden">
                    Puntaje del mes (método anterior){" "}
                  </span>
                  {numero(p.score, 0)}
                </span>
                <Semaforo tono={tonoDe(p.color)}>
                  <span className="visually-hidden">Cumplimiento </span>
                  {porcentaje(p.completed_pct)} · {CUMPLIMIENTO_CORTO[p.color]}
                </Semaforo>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mz-small mz-faint mb-0 gk-personas__nota">
        Cumplimiento: {CUMPLIMIENTO_TEXTO.green} · {CUMPLIMIENTO_TEXTO.yellow} ·{" "}
        {CUMPLIMIENTO_TEXTO.red}.
      </p>
    </section>
  );
}

function Persona({ persona, mes, veRiesgo, enCurso, onVolver }) {
  const carga = useCarga(
    () => kpiService.kpiDe(persona.id, mes),
    [persona.id, mes],
    "No se pudieron cargar los KPI de esta persona.",
  );
  const titulo = useRef(null);
  const [simulando, setSimulando] = useState(false);

  // Al elegir a otra persona, el foco va a su nombre (y no se pierde).
  useEffect(() => {
    titulo.current?.focus();
  }, [persona.id]);

  const kpi = carga.datos;
  return (
    <div className="mz-stack">
      {/* En el teléfono la lista queda arriba, lejos: un atajo de vuelta. */}
      <div className="gk-solo-telefono">
        <button type="button" className="btn btn-link px-0" onClick={onVolver}>
          <Icon name="arrow-left" /> Volver a la lista
        </button>
      </div>
      <div className="gk-persona-cabeza">
        <h3 ref={titulo} tabIndex={-1} className="gp-titulo mb-0">
          {persona.name}
        </h3>
        <span className="mz-faint">{rolLegible(persona.role)}</span>
        {kpi && enCurso && (
          <button
            type="button"
            className="btn btn-outline-primary btn-sm ms-auto"
            onClick={() => setSimulando(true)}
          >
            <Icon name="sliders" /> ¿Qué pasaría si…?
          </button>
        )}
      </div>
      {!kpi ? (
        <EstadoSeccion carga={carga} />
      ) : (
        <DetalleKpi kpi={kpi} conRiesgo={veRiesgo} enCurso={enCurso} />
      )}
      {simulando && enCurso && (
        <Simulador
          usuarioId={persona.id}
          nombre={persona.name}
          onCerrar={() => setSimulando(false)}
        />
      )}
    </div>
  );
}

function BalanceDeCarga({ personas }) {
  const ordenadas = [...personas].sort((a, b) => b.carga_pct - a.carga_pct);
  return (
    <Seccion titulo="Balance de carga del equipo" ayuda="cargaLaboral">
      <ul className="gk-barras">
        {ordenadas.map((p) => (
          <li key={p.id}>
            <span className="gk-barras__etiqueta gt-corta">{p.name}</span>
            <span className="gh-avance gk-barras__barra" aria-hidden="true">
              <span
                className={`gk-relleno--${tonoDe(p.carga_color)}`}
                style={{ width: `${Math.min(100, p.carga_pct)}%` }}
              />
            </span>
            <span className="mz-small">
              {porcentaje(p.carga_pct)}{" "}
              <Semaforo tono={tonoDe(p.carga_color)}>{p.carga_label}</Semaforo>
            </span>
          </li>
        ))}
      </ul>
    </Seccion>
  );
}

function CapacidadDelEquipo() {
  const carga = useCarga(
    () => kpiService.capacidadDelEquipo(),
    [],
    "No se pudo cargar la capacidad del equipo.",
  );
  const [abierta, setAbierta] = useState(null);
  const [simulando, setSimulando] = useState(null);
  const d = carga.datos;
  const miembros = [...(d?.members ?? [])].sort(
    (a, b) => a.disponible - b.disponible,
  );
  const sinEstimar = miembros.reduce(
    (s, m) => s + (m.tasks_sin_estimar ?? 0),
    0,
  );

  return (
    <Seccion titulo="Capacidad para asumir nuevas tareas">
      {!d ? (
        <EstadoSeccion carga={carga} />
      ) : (
        <div className="mz-stack">
          <p className="gp-marcas mb-0">
            <Semaforo tono="ok">{d.summary.alta} con capacidad alta</Semaforo>
            <Semaforo tono="warn">
              {d.summary.limitada} con capacidad limitada
            </Semaforo>
            <Semaforo tono="bad">
              {d.summary.sobrecargados} sobrecargadas
            </Semaforo>
            {d.summary.sin_planificacion > 0 && (
              <Semaforo tono="neutral">
                {d.summary.sin_planificacion} sin planificación
              </Semaforo>
            )}
          </p>
          {sinEstimar > 0 && (
            <p className="mz-small gt-texto--warn mb-0">
              {sinEstimar}{" "}
              {sinEstimar === 1 ? "tarea no tiene" : "tareas no tienen"} tiempo
              objetivo: la capacidad proyectada puede estar subestimada.
            </p>
          )}
          {miembros.length === 0 ? (
            <p className="mz-faint mb-0">Sin personas para mostrar.</p>
          ) : (
            <ul className="gk-lista">
              {miembros.map((m) => {
                const id = `gk-capacidad-${m.id}`;
                const tono = CAPACIDAD_TONO[m.estado_color] ?? "neutral";
                return (
                  <li key={m.id} className="gh-recuadro">
                    <button
                      type="button"
                      className="gk-desplegar"
                      aria-expanded={abierta === m.id}
                      aria-controls={id}
                      onClick={() =>
                        setAbierta((a) => (a === m.id ? null : m.id))
                      }
                    >
                      <Icon
                        name={
                          abierta === m.id ? "chevron-down" : "chevron-right"
                        }
                      />
                      <span className="mz-strong flex-grow-1 text-start">
                        {m.name}
                      </span>
                      <span className="mz-small">
                        {horasConSigno(m.disponible)} (
                        {porcentaje(m.disponible_pct)})
                      </span>
                      <Semaforo tono={tono}>{m.estado_label}</Semaforo>
                    </button>
                    <div id={id} hidden={abierta !== m.id} className="mt-2">
                      <dl className="gh-tarjeta-kv gh-tarjeta-kv--estrecha mz-small mb-2">
                        <dt>Horas restantes hoy</dt>
                        <dd>{horas(m.horas_restantes_hoy)}</dd>
                        <dt>Días laborables restantes</dt>
                        <dd>{m.dias_laborables_restantes}</dd>
                        <dt>Base futura total</dt>
                        <dd>{horas(m.base_futura_total)}</dd>
                        <dt>Tareas en progreso (restante)</dt>
                        <dd>{horas(m.comprometido_en_progreso)}</dd>
                        <dt>Tareas pendientes (este mes)</dt>
                        <dd>{horas(m.comprometido_pendiente)}</dd>
                        <dt>Comprometido futuro</dt>
                        <dd>{horas(m.comprometido_futuro)}</dd>
                        <dt>Disponible</dt>
                        <dd>
                          {horasConSigno(m.disponible)} (
                          {porcentaje(m.disponible_pct)})
                        </dd>
                      </dl>
                      {m.tasks_sin_estimar > 0 && (
                        <p className="mz-small gt-texto--warn">
                          {m.tasks_sin_estimar}{" "}
                          {m.tasks_sin_estimar === 1
                            ? "tarea no tiene"
                            : "tareas no tienen"}{" "}
                          tiempo objetivo definido.
                        </p>
                      )}
                      <p className="mz-small mz-faint mb-2">
                        Confiabilidad del cálculo:{" "}
                        {porcentaje(m.confiabilidad?.pct)} ·{" "}
                        {m.confiabilidad?.holidays_configured
                          ? "feriados configurados"
                          : "sin feriados configurados para este año"}
                      </p>
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() => setSimulando(m)}
                      >
                        Simular asignación
                        <span className="visually-hidden"> a {m.name}</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {simulando && (
        <Simulador
          usuarioId={simulando.id}
          nombre={simulando.name}
          escenarios={ESCENARIOS_DE_CAPACIDAD}
          onCerrar={() => setSimulando(null)}
        />
      )}
    </Seccion>
  );
}
