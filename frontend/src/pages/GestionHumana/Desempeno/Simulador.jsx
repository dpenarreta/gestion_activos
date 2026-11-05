/*
 * «¿Qué pasaría si…?» (`WhatIfSimulator` y `SimulatorPanel` de Nexo): ocho
 * escenarios sobre el Puntaje de desempeño, la carga, la capacidad y el
 * Equilibrio Operativo de una persona. El servidor nunca guarda nada: al
 * cerrar, el resultado se descarta. A diferencia de Nexo, se simula al
 * pulsar «Simular» (no con cada tecla).
 */
import { useRef, useState } from "react";

import { errorDeKpi, kpiService } from "../../../api/kpiService";
import {
  Campo,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { ErrorEnLinea } from "../comunes";
import { PreviaHoras } from "../Tareas/Indicadores";
import {
  AYUDA_HORAS,
  HORAS_INVALIDAS,
  horasValidas,
  textoAHoras,
} from "../Tareas/tareasComunes";
import { PanelLateral } from "../Tareas/Ventanas";
import { Semaforo } from "./Componentes";
import { TONO_CLASIFICACION, numero, porcentaje, tonoDe } from "./kpiComunes";

export const ESCENARIOS = {
  complete_task: {
    texto: "Completar tareas",
    grupo: "Rendimiento",
    nota: "Afecta el Puntaje de desempeño (factor Cumplimiento).",
    campos: [
      { clave: "count", etiqueta: "Tareas a completar", tipo: "numero" },
    ],
  },
  reduce_overdue: {
    texto: "Reducir vencidas",
    grupo: "Rendimiento",
    nota: "Afecta el Puntaje de desempeño (factor Tareas vencidas).",
    campos: [
      {
        clave: "count",
        etiqueta: "Tareas vencidas a resolver",
        tipo: "numero",
      },
      {
        clave: "alta",
        etiqueta: "De esas, de prioridad Alta",
        tipo: "numero",
        ceroValido: true,
      },
    ],
  },
  increase_consistency: {
    texto: "Subir consistencia",
    grupo: "Rendimiento",
    nota: "Afecta el Puntaje de desempeño (factor Consistencia).",
    campos: [
      {
        clave: "delta_points",
        etiqueta: "Puntos adicionales de consistencia",
        tipo: "numero",
      },
    ],
  },
  register_hours: {
    texto: "Registrar horas",
    grupo: "Carga y capacidad",
    nota: "Afecta la carga laboral y el Equilibrio Operativo; el Puntaje de desempeño no pondera horas trabajadas.",
    campos: [
      {
        clave: "hours",
        etiqueta: "Horas adicionales este mes (HH.MM)",
        tipo: "horas",
      },
    ],
  },
  assign_task: {
    texto: "Nueva tarea",
    grupo: "Carga y capacidad",
    nota: "Afecta la capacidad disponible y el Equilibrio Operativo.",
    campos: [
      {
        clave: "hours",
        etiqueta: "Tiempo objetivo de la nueva tarea (HH.MM)",
        tipo: "horas",
      },
    ],
  },
  daily_hours: {
    texto: "Horas efectivas",
    grupo: "Carga y capacidad",
    nota: "Afecta la carga laboral, la capacidad disponible y el Equilibrio Operativo.",
    campos: [
      {
        clave: "new_hours_per_day",
        etiqueta: "Nuevas horas efectivas por día (HH.MM)",
        tipo: "horas",
      },
    ],
  },
  vacation: {
    texto: "Vacaciones",
    grupo: "Carga y capacidad",
    nota: "Afecta la capacidad disponible y el Equilibrio Operativo.",
    campos: [{ clave: "days", etiqueta: "Días de vacaciones", tipo: "numero" }],
  },
  permiso: {
    texto: "Permiso",
    grupo: "Carga y capacidad",
    nota: "Afecta la carga laboral, la capacidad disponible y el Equilibrio Operativo.",
    campos: [
      { clave: "hours", etiqueta: "Horas de permiso (HH.MM)", tipo: "horas" },
    ],
  },
};

export const ESCENARIOS_DE_CAPACIDAD = [
  "assign_task",
  "daily_hours",
  "vacation",
  "permiso",
];

export function valorDe(campo, texto) {
  const t = String(texto ?? "").trim();
  if (!t) return { error: "Complete este campo." };
  if (campo.tipo === "horas") {
    if (!horasValidas(t)) return { error: HORAS_INVALIDAS };
    const n = textoAHoras(t);
    return n > 0 ? { valor: n } : { error: "Debe ser mayor que cero." };
  }
  if (!/^\d+([.,]\d+)?$/.test(t)) return { error: "Escriba un número." };
  const n = Number(t.replace(",", "."));
  if (!campo.ceroValido && n <= 0) return { error: "Debe ser mayor que cero." };
  return { valor: n };
}

const FILAS = [
  [
    "performance_score_pts",
    "Puntaje de desempeño",
    (v) => numero(Math.round(v), 0),
  ],
  ["performance_score_class", "Clasificación del desempeño", (v) => v],
  ["health_score", "Equilibrio Operativo", (v) => numero(v)],
  ["health_classification", "Clasificación del Equilibrio", (v) => v],
  ["carga_pct", "Carga laboral", (v) => porcentaje(v)],
  ["carga_label", "Zona de carga", (v) => v],
  ["capacidad_disponible_pct", "Capacidad disponible", (v) => porcentaje(v)],
  [
    "capacidad_disponible_horas",
    "Capacidad disponible (horas)",
    (v) => `${numero(v)} h`,
  ],
  ["cumplimiento_pct", "Cumplimiento", (v) => porcentaje(v)],
  ["estado", "Estado de capacidad", (v) => ESTADO_CAPACIDAD[v] ?? v],
  ["participants", "Participantes", (v) => numero(v, 0)],
  [
    "avg_remaining_hours_per_participant",
    "Horas restantes por participante",
    (v) => `${numero(v)} h`,
  ],
];

const ESTADO_CAPACIDAD = {
  alta: "Puede asumir proyectos",
  limitada: "Capacidad limitada",
  "no-asignar": "No asignar nuevas tareas",
  sobrecarga: "Sobrecarga proyectada",
  "sin-planificacion": "Sin planificación",
};

/** Qué es mejor en cada indicador numérico: más alto (`1`), más bajo
 * (`-1`) o depende de la zona (`0`, la carga). */
const SENTIDO = {
  performance_score_pts: 1,
  health_score: 1,
  capacidad_disponible_pct: 1,
  capacidad_disponible_horas: 1,
  cumplimiento_pct: 1,
  carga_pct: 0,
  avg_remaining_hours_per_participant: -1,
};

function Cambio({ clave, antes, despues }) {
  if (typeof antes !== "number" || typeof despues !== "number") {
    return antes === despues ? (
      <span className="mz-faint">Sin cambio</span>
    ) : (
      <span>Cambia</span>
    );
  }
  const d = Math.round((despues - antes) * 100) / 100;
  if (d === 0) return <span className="mz-faint">Sin cambio</span>;
  const sentido = SENTIDO[clave] ?? 0;
  if (!sentido)
    return <Semaforo tono="neutral">{d > 0 ? "▲ sube" : "▼ baja"}</Semaforo>;
  const mejora = sentido * d > 0;
  return (
    <Semaforo tono={mejora ? "ok" : "bad"}>
      {d > 0 ? "▲" : "▼"} {mejora ? "mejora" : "empeora"}
    </Semaforo>
  );
}

/** «Simulación lista: Puntaje de desempeño 43 → 61» (para `role="status"`). */
export function resumenDeSimulacion(r) {
  const a = r?.before ?? {};
  const b = r?.after ?? {};
  for (const [k, nombre, formato] of FILAS) {
    if (k in a && a[k] !== b[k])
      return `Simulación lista: ${nombre} ${formato(a[k])} → ${formato(b[k])}.`;
  }
  return "Simulación lista: sin cambios en los indicadores.";
}

export function ResultadoDeSimulacion({ antes, despues }) {
  const filas = FILAS.filter(([k]) => k in (antes ?? {}));
  return (
    <div className="mz-table-wrap">
      <table className="mz-table gt-tabla">
        <caption className="visually-hidden">
          Antes y después de la simulación
        </caption>
        <thead>
          <tr>
            <th scope="col" className="gt-fija">
              Indicador
            </th>
            <th scope="col" className="num">
              Antes
            </th>
            <th scope="col" className="num">
              Después
            </th>
            <th scope="col">Cambio</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(([k, nombre, formato]) => {
            const cambio = antes[k] !== despues[k];
            return (
              <tr key={k}>
                <th scope="row" className="gt-fija">
                  {nombre}
                </th>
                <td className="num">{formato(antes[k])}</td>
                <td className={`num${cambio ? " mz-strong" : ""}`}>
                  {k === "carga_label" ? (
                    <Semaforo tono={tonoDe(despues.carga_color)}>
                      {despues[k]}
                    </Semaforo>
                  ) : k.endsWith("_class") || k === "health_classification" ? (
                    <Semaforo
                      tono={TONO_CLASIFICACION[despues[k]] ?? "neutral"}
                    >
                      {despues[k]}
                    </Semaforo>
                  ) : (
                    formato(despues[k])
                  )}
                </td>
                <td>
                  <Cambio clave={k} antes={antes[k]} despues={despues[k]} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * El panel del simulador para una persona. `escenarios`: los que se ofrecen
 * (todos, o solo los de capacidad desde la tarjeta de capacidad del equipo).
 */
export function Simulador({
  usuarioId,
  nombre,
  escenarios = Object.keys(ESCENARIOS),
  onCerrar,
}) {
  const [escenario, setEscenario] = useState(escenarios[0]);
  const [valores, setValores] = useState({});
  const [errores, setErrores] = useState({});
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  const [simulando, setSimulando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const enCurso = useRef(false);
  const formulario = useRef(null);
  const def = ESCENARIOS[escenario];
  const grupos = [...new Set(escenarios.map((e) => ESCENARIOS[e].grupo))];

  async function simular(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const cuerpo = { type: escenario };
    const e = {};
    for (const campo of def.campos) {
      const r = valorDe(campo, valores[campo.clave]);
      if (r.error) e[campo.clave] = r.error;
      else cuerpo[campo.clave] = r.valor;
    }
    if (
      escenario === "reduce_overdue" &&
      !e.alta &&
      !e.count &&
      cuerpo.alta > cuerpo.count
    )
      e.alta = "No puede ser mayor que las tareas a resolver.";
    setErrores(e);
    setError(null);
    setMensaje(null);
    if (Object.keys(e).length) {
      enfocarPrimerError(formulario.current);
      return;
    }
    enCurso.current = true;
    setSimulando(true);
    try {
      const r = await kpiService.simular(usuarioId, cuerpo);
      setResultado(r);
      setMensaje(resumenDeSimulacion(r));
    } catch (err) {
      setResultado(null);
      const fallo = errorDeKpi(err, "No se pudo simular.");
      setErrores(fallo.campos);
      setError(fallo.mensaje);
    } finally {
      enCurso.current = false;
      setSimulando(false);
    }
  }

  return (
    <PanelLateral
      titulo="¿Qué pasaría si…?"
      subtitulo={nombre}
      onCerrar={onCerrar}
    >
      <form ref={formulario} className="mz-stack" onSubmit={simular}>
        {grupos.map((g) => (
          <fieldset key={g}>
            <legend className="form-label gt-legend">{g}</legend>
            <div className="gt-opciones">
              {escenarios
                .filter((e) => ESCENARIOS[e].grupo === g)
                .map((e) => (
                  <label key={e} className="gt-opcion">
                    <input
                      type="radio"
                      name="gk-escenario"
                      value={e}
                      checked={escenario === e}
                      onChange={() => {
                        setEscenario(e);
                        setValores({});
                        setErrores({});
                        setResultado(null);
                        setError(null);
                      }}
                    />
                    <span className="gt-opcion__texto">
                      {ESCENARIOS[e].texto}
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>
        ))}
        <p className="mz-small mz-faint mb-0">{def.nota}</p>
        {def.campos.map((campo) => (
          <div key={`${escenario}-${campo.clave}`}>
            <Campo
              id={`gk-sim-${campo.clave}`}
              etiqueta={campo.etiqueta}
              obligatorio
              error={errores[campo.clave]}
              ayuda={campo.tipo === "horas" ? AYUDA_HORAS : undefined}
            >
              <input
                className="form-control"
                inputMode="decimal"
                value={valores[campo.clave] ?? ""}
                onChange={(ev) =>
                  setValores((v) => ({ ...v, [campo.clave]: ev.target.value }))
                }
              />
            </Campo>
            {campo.tipo === "horas" && (
              <PreviaHoras texto={valores[campo.clave]} />
            )}
          </div>
        ))}
        <ErrorEnLinea mensaje={error} />
        <div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={simulando}
          >
            {simulando ? "Simulando…" : "Simular"}
          </button>
        </div>
        <p role="status" className="visually-hidden">
          {mensaje}
        </p>
        {resultado && (
          <>
            <h4 className="gk-subtitulo">Resultado de la simulación</h4>
            <ResultadoDeSimulacion
              antes={resultado.before}
              despues={resultado.after}
            />
          </>
        )}
        <p className="mz-small mz-faint mb-0">
          Es solo una simulación: no guarda ni modifica ningún dato.
        </p>
      </form>
    </PanelLateral>
  );
}
