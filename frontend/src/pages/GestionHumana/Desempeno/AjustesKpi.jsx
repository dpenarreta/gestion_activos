/*
 * Ajustes del motor de KPI (`kpi.administrar`; en Nexo, los ajustes del
 * ADMINISTRADOR): ponderaciones y umbrales, límites del semáforo de carga,
 * ventana de predicción, curvas de normalización, objetivo de referencia por
 * rol, Matriz de Compatibilidad Operativa y fecha de inicio del KPI de cada
 * persona. El servidor valida todo (rangos, sumas en 100, orden de los
 * umbrales y de los límites, curvas, niveles) y responde con el motivo, que
 * se muestra tal cual. Cada cambio queda en la auditoría.
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { errorDeKpi, kpiService } from "../../../api/kpiService";
import { Campo } from "../../../components/common/Campo/Campo";
import { confirmar } from "../../../components/common/Confirmar/confirmar";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../../components/common/Pestanas/Pestanas";
import { KPI_ADMINISTRAR } from "../../../modulos/permisosGestionHumana";
import { ErrorEnLinea } from "../comunes";
import { Encabezado } from "../Tareas/ContextoTareas";
import { PreviaHoras } from "../Tareas/Indicadores";
import {
  AYUDA_HORAS,
  HORAS_INVALIDAS,
  horasATexto,
  horasValidas,
  textoAHoras,
} from "../Tareas/tareasComunes";
import { EstadoSeccion, Seccion, Semaforo } from "./Componentes";
import { ConAccesoKpi, useCarga } from "./ContextoKpi";
import { horas, numero } from "./kpiComunes";

export function AjustesKpi() {
  return (
    <ConAccesoKpi titulo="Ajustes de KPI" permiso={KPI_ADMINISTRAR}>
      <PantallaAjustes />
    </ConAccesoKpi>
  );
}

const PESTANAS = [
  { id: "motor", etiqueta: "Pesos y umbrales" },
  { id: "carga", etiqueta: "Semáforo de carga" },
  { id: "prediccion", etiqueta: "Predicción" },
  { id: "curvas", etiqueta: "Curvas" },
  { id: "objetivos", etiqueta: "Objetivo por rol" },
  { id: "compatibilidad", etiqueta: "Compatibilidad" },
  { id: "inicio", etiqueta: "Inicio del KPI" },
];

function PantallaAjustes() {
  const [parametros, setParametros] = useSearchParams();
  const vista = PESTANAS.some((p) => p.id === parametros.get("seccion"))
    ? parametros.get("seccion")
    : "motor";
  return (
    <div className="gh-page">
      <Encabezado
        titulo="Ajustes de KPI"
        descripcion="Cómo calcula el motor los indicadores de Desempeño. Los cambios rigen desde ahora y quedan en la auditoría."
      />
      <Pestanas
        etiqueta="Secciones de los ajustes de KPI"
        idBase="gk-ajustes"
        valor={vista}
        onCambio={(v) =>
          setParametros(v === "motor" ? {} : { seccion: v }, { replace: true })
        }
        opciones={PESTANAS}
      />
      <PanelDePestana idBase="gk-ajustes" valor={vista}>
        {vista === "motor" && <Motor />}
        {vista === "carga" && <LimitesDeCarga />}
        {vista === "prediccion" && <Ventana />}
        {vista === "curvas" && <Curvas />}
        {vista === "objetivos" && <Objetivos />}
        {vista === "compatibilidad" && <Compatibilidad />}
        {vista === "inicio" && <FechasDeInicio />}
      </PanelDePestana>
    </div>
  );
}

/** El resultado de guardar: un aviso que se anuncia (`role="status"`). */
function useGuardado() {
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);
  const [campos, setCampos] = useState({});
  const [guardando, setGuardando] = useState(null);
  const enCurso = useRef(false);
  /** `pregunta`: si se pasa, se confirma antes de guardar. */
  async function guardar(clave, accion, texto, pregunta) {
    if (enCurso.current) return null;
    if (pregunta && !(await confirmar(pregunta))) return null;
    enCurso.current = true;
    setCampos({});
    setGuardando(clave);
    setMensaje(null);
    setError(null);
    try {
      const r = await accion();
      setMensaje(texto);
      return r ?? true;
    } catch (err) {
      const fallo = errorDeKpi(err, "No se pudo guardar.");
      setError(fallo.mensaje);
      setCampos(fallo.campos);
      return null;
    } finally {
      enCurso.current = false;
      setGuardando(null);
    }
  }
  const avisos = (
    <>
      <p role="status" className="visually-hidden">
        {mensaje}
      </p>
      {mensaje && (
        <div className="mz-alert mz-alert--ok" aria-hidden="true">
          <Icon name="check2-circle" />
          <span>{mensaje}</span>
        </div>
      )}
      <ErrorEnLinea mensaje={error} />
    </>
  );
  return { guardar, guardando, avisos, campos };
}

// --- Pesos y umbrales -----------------------------------------------------------------

const GRUPOS = [
  {
    titulo: "Ponderaciones del Equilibrio Operativo",
    suma: true,
    claves: {
      health_weight_cumplimiento: "Cumplimiento",
      health_weight_carga: "Carga laboral",
      health_weight_vencidas: "Tareas vencidas",
      health_weight_consistencia: "Consistencia",
      health_weight_capacidad: "Capacidad futura",
    },
  },
  {
    titulo: "Ponderaciones del Performance Score",
    suma: true,
    claves: {
      perf_weight_cumplimiento: "Cumplimiento",
      perf_weight_vencidas: "Tareas vencidas",
      perf_weight_consistencia: "Consistencia",
      perf_weight_trazabilidad: "Trazabilidad",
    },
  },
  {
    titulo: "Ponderaciones del Índice de Riesgo Operativo",
    suma: true,
    claves: {
      risk_weight_sobrecarga: "Sobrecarga proyectada",
      risk_weight_vencidas_criticas: "Vencidas críticas",
      risk_weight_tendencia_negativa: "Tendencia negativa",
      risk_weight_horas_extra: "Horas extra",
      risk_weight_baja_capacidad: "Baja capacidad",
      risk_weight_variabilidad: "Variabilidad",
      risk_weight_concentracion: "Concentración de actividades",
      risk_weight_sin_planificacion: "Sin planificación",
    },
  },
  {
    titulo: "Umbrales del riesgo (Medio < Alto < Crítico)",
    claves: {
      risk_threshold_medio: "Desde Medio",
      risk_threshold_alto: "Desde Alto",
      risk_threshold_critico: "Desde Crítico",
    },
  },
  {
    titulo: "Alertas, anomalías y predicción",
    claves: {
      alert_overdue_task_threshold: "Tareas vencidas para alertar",
      alert_consecutive_overload_days:
        "Días seguidos de sobrecarga para alertar",
      anomaly_variation_threshold_pct: "Variación para anomalía (%)",
      prediction_min_weeks_media: "Semanas mínimas para confianza media",
      prediction_min_weeks_alta: "Semanas mínimas para confianza alta",
      cache_ttl_minutes: "Vigencia del cálculo (minutos)",
    },
  },
];

const RECALCULA =
  "Recalcula los KPI de todas las personas desde ahora. Los meses ya cerrados no cambian.";
const PREGUNTA_TITULO = "¿Guardar este cambio del motor de KPI?";

function Motor() {
  const carga = useCarga(
    () => kpiService.configuracion(),
    [],
    "No se pudieron cargar los ajustes.",
  );
  if (!carga.datos) return <EstadoSeccion carga={carga} />;
  return (
    <div className="mz-stack">
      {GRUPOS.map((g) => (
        <GrupoMotor
          key={g.titulo}
          grupo={g}
          actual={carga.datos.config}
          defectos={carga.datos.defaults}
          onGuardado={carga.recargar}
        />
      ))}
    </div>
  );
}

function GrupoMotor({ grupo: g, actual, defectos, onGuardado }) {
  const [valores, setValores] = useState(() =>
    Object.fromEntries(
      Object.keys(g.claves).map((k) => [k, String(actual[k])]),
    ),
  );
  const { guardar, guardando, avisos, campos } = useGuardado();
  const num = (k) => Number(String(valores[k]).replace(",", "."));
  const suma = Object.keys(g.claves).reduce((s, k) => s + (num(k) || 0), 0);
  const cambiado = Object.keys(g.claves).some((k) => num(k) !== actual[k]);

  async function enviar(evento) {
    evento.preventDefault();
    const cambios = {};
    for (const k of Object.keys(g.claves)) {
      if (num(k) !== actual[k]) cambios[k] = num(k);
    }
    if (!Object.keys(cambios).length) return;
    const r = await guardar(
      g.titulo,
      () => kpiService.guardarConfiguracion(cambios),
      `${g.titulo}: guardado.`,
      {
        titulo: PREGUNTA_TITULO,
        mensaje: RECALCULA,
        accion: "Guardar",
        peligro: false,
      },
    );
    if (r?.config) onGuardado();
  }

  return (
    <Seccion titulo={g.titulo}>
      <form onSubmit={enviar}>
        <div className="gk-campos">
          {Object.entries(g.claves).map(([k, etiqueta]) => (
            <Campo
              key={k}
              id={`gk-cfg-${k}`}
              etiqueta={etiqueta}
              ayuda={`Por defecto: ${numero(defectos[k])}`}
              error={campos[k]}
            >
              <input
                type="number"
                className="form-control"
                value={valores[k]}
                onChange={(e) =>
                  setValores((v) => ({ ...v, [k]: e.target.value }))
                }
              />
            </Campo>
          ))}
        </div>
        <div className="gk-pie-form">
          {g.suma && (
            <Semaforo tono={Math.round(suma) === 100 ? "ok" : "bad"}>
              Suma: {numero(suma)}{" "}
              {Math.round(suma) === 100 ? "(correcta)" : "(debe sumar 100)"}
            </Semaforo>
          )}
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!cambiado || guardando === g.titulo}
          >
            {guardando === g.titulo ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
      {avisos}
    </Seccion>
  );
}

// --- Semáforo de carga ------------------------------------------------------------------

const LIMITES = {
  workload_limit_low: "Límite de Subutilización (por día)",
  workload_limit_high: "Límite superior óptimo (por día)",
  workload_limit_overload: "Límite de Sobrecarga (por día)",
};

function LimitesDeCarga() {
  const carga = useCarga(
    () => kpiService.limitesDeCarga(),
    [],
    "No se pudieron cargar los límites.",
  );
  const [valores, setValores] = useState(null);
  const [errores, setErrores] = useState({});
  const { guardar, guardando, avisos, campos } = useGuardado();
  const d = carga.datos;

  useEffect(() => {
    if (d)
      setValores(
        Object.fromEntries(
          Object.keys(LIMITES).map((k) => [k, horasATexto(d[k])]),
        ),
      );
  }, [d]);

  if (!d || !valores) return <EstadoSeccion carga={carga} />;

  async function enviar(e) {
    e.preventDefault();
    const err = {};
    const cambios = {};
    for (const k of Object.keys(LIMITES)) {
      if (!horasValidas(valores[k])) err[k] = HORAS_INVALIDAS;
      else if (textoAHoras(valores[k]) !== d[k])
        cambios[k] = textoAHoras(valores[k]);
    }
    setErrores(err);
    if (Object.keys(err).length || !Object.keys(cambios).length) return;
    if (
      await guardar(
        "carga",
        () => kpiService.guardarLimitesDeCarga(cambios),
        "Límites guardados.",
        {
          titulo: PREGUNTA_TITULO,
          mensaje: RECALCULA,
          accion: "Guardar",
          peligro: false,
        },
      )
    )
      carga.recargar();
  }

  return (
    <Seccion titulo="Semáforo de carga laboral">
      <form onSubmit={enviar}>
        <p className="mz-small">
          Orden obligatorio: Subutilización &lt; horas efectivas (
          {horas(d.hours_per_day)}) ≤ límite óptimo &lt; Sobrecarga. Las horas
          efectivas por día ({horas(d.hours_per_day)}) y las esperadas del mes (
          {horas(d.monthly_expected_hours)}) se ajustan en los Ajustes de
          tareas.
        </p>
        <div className="gk-campos">
          {Object.entries(LIMITES).map(([k, etiqueta]) => (
            <div key={k}>
              <Campo
                id={`gk-lim-${k}`}
                etiqueta={etiqueta}
                ayuda={AYUDA_HORAS}
                error={errores[k] ?? campos[k]}
              >
                <input
                  className="form-control"
                  inputMode="decimal"
                  value={valores[k]}
                  onChange={(e) =>
                    setValores((v) => ({ ...v, [k]: e.target.value }))
                  }
                />
              </Campo>
              <PreviaHoras texto={valores[k]} />
            </div>
          ))}
        </div>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={guardando === "carga"}
        >
          {guardando === "carga" ? "Guardando…" : "Guardar límites"}
        </button>
      </form>
      {avisos}
    </Seccion>
  );
}

// --- Ventana de predicción ------------------------------------------------------------

function Ventana() {
  const carga = useCarga(
    () => kpiService.ventanaDePrediccion(),
    [],
    "No se pudo cargar la ventana.",
  );
  const [valor, setValor] = useState("");
  const { guardar, guardando, avisos } = useGuardado();
  const d = carga.datos;
  useEffect(() => {
    if (d) setValor(String(d.window_weeks));
  }, [d]);
  if (!d) return <EstadoSeccion carga={carga} />;
  return (
    <Seccion titulo="Ventana histórica de la Inteligencia preventiva">
      <form
        className="gk-pie-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await guardar(
              "ventana",
              () => kpiService.guardarVentanaDePrediccion(valor),
              "Ventana de predicción guardada.",
            )
          )
            carga.recargar();
        }}
      >
        <Campo id="gk-ventana" etiqueta="Semanas de histórico">
          <select
            className="form-select"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          >
            {d.options.map((o) => (
              <option key={o} value={o}>
                {o} semanas
              </option>
            ))}
          </select>
        </Campo>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={valor === String(d.window_weeks) || guardando === "ventana"}
        >
          {guardando === "ventana" ? "Guardando…" : "Guardar"}
        </button>
      </form>
      {avisos}
    </Seccion>
  );
}

// --- Curvas de normalización ------------------------------------------------------------

const CURVA = {
  cumplimiento: "Cumplimiento",
  vencidas: "Tareas vencidas",
  carga: "Carga laboral",
  capacidad: "Capacidad futura",
  consistencia: "Consistencia",
  trazabilidad: "Trazabilidad",
};

function Curvas() {
  const carga = useCarga(
    () => kpiService.curvas(),
    [],
    "No se pudieron cargar las curvas.",
  );
  const d = carga.datos;
  if (!d) return <EstadoSeccion carga={carga} />;
  return (
    <div className="mz-stack">
      <p className="mz-small mb-0">
        Cada curva convierte el valor original de un factor (x) en un puntaje de
        0 a 100 (y). Se necesitan al menos 2 puntos.
      </p>
      {Object.keys(CURVA).map((nombre) => (
        <Curva
          key={nombre}
          nombre={nombre}
          puntos={d.curves[nombre] ?? []}
          defecto={d.defaults?.[nombre] ?? []}
          onGuardada={carga.recargar}
        />
      ))}
    </div>
  );
}

function Curva({ nombre, puntos, defecto, onGuardada }) {
  const [filas, setFilas] = useState(() =>
    puntos.map((p) => ({ x: String(p.x), y: String(p.y) })),
  );
  const { guardar, guardando, avisos } = useGuardado();
  const [error, setError] = useState(null);

  async function enviar(e) {
    e.preventDefault();
    const nuevos = filas.map((f) => ({
      x: Number(String(f.x).replace(",", ".")),
      y: Number(String(f.y).replace(",", ".")),
    }));
    if (
      nuevos.length < 2 ||
      nuevos.some(
        (p) =>
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          p.y < 0 ||
          p.y > 100,
      )
    ) {
      setError(
        "Se necesitan al menos 2 puntos con x numérico e y entre 0 y 100.",
      );
      return;
    }
    setError(null);
    if (
      await guardar(
        nombre,
        () => kpiService.guardarCurva(nombre, nuevos),
        `Curva de ${CURVA[nombre]} guardada.`,
        {
          titulo: PREGUNTA_TITULO,
          mensaje: RECALCULA,
          accion: "Guardar",
          peligro: false,
        },
      )
    )
      onGuardada();
  }

  return (
    <Seccion titulo={`Curva: ${CURVA[nombre]}`}>
      <ErrorEnLinea mensaje={error} />
      <form onSubmit={enviar}>
        <div className="mz-table-wrap gk-tabla-chica">
          <table className="mz-table">
            <caption className="visually-hidden">
              Puntos de la curva de {CURVA[nombre]}
            </caption>
            <thead>
              <tr>
                <th scope="col">Valor original (x)</th>
                <th scope="col">Puntaje (y)</th>
                <th scope="col">
                  <span className="visually-hidden">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                // El orden de las filas es el de la curva: el índice es su identidad.
                <tr key={i}>
                  <td>
                    <input
                      className="form-control form-control-sm"
                      inputMode="decimal"
                      aria-label={`x del punto ${i + 1}`}
                      value={f.x}
                      onChange={(e) =>
                        setFilas((l) =>
                          l.map((p, j) =>
                            j === i ? { ...p, x: e.target.value } : p,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="form-control form-control-sm"
                      inputMode="decimal"
                      aria-label={`y del punto ${i + 1}`}
                      value={f.y}
                      onChange={(e) =>
                        setFilas((l) =>
                          l.map((p, j) =>
                            j === i ? { ...p, y: e.target.value } : p,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      disabled={filas.length <= 2}
                      onClick={() =>
                        setFilas((l) => l.filter((_, j) => j !== i))
                      }
                    >
                      Quitar
                      <span className="visually-hidden"> el punto {i + 1}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="gk-pie-form">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setFilas((l) => [...l, { x: "", y: "" }])}
          >
            <Icon name="plus-lg" /> Agregar punto
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() =>
              setFilas(defecto.map((p) => ({ x: String(p.x), y: String(p.y) })))
            }
          >
            Usar la curva por defecto
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={guardando === nombre}
          >
            {guardando === nombre ? "Guardando…" : "Guardar curva"}
          </button>
        </div>
      </form>
      {avisos}
    </Seccion>
  );
}

// --- Objetivo por rol ---------------------------------------------------------------------

const OBJETIVO = {
  performance: "Performance esperado (pts)",
  riesgo_max: "Riesgo operativo máximo (pts)",
  cumplimiento: "Cumplimiento esperado (%)",
};

function Objetivos() {
  const carga = useCarga(
    () => kpiService.objetivosPorRol(),
    [],
    "No se pudieron cargar los objetivos.",
  );
  const d = carga.datos;
  if (!d) return <EstadoSeccion carga={carga} />;
  return (
    <div className="mz-stack">
      <p className="mz-small mb-0">
        El objetivo de referencia de cada rol se compara en la «Referencia
        utilizada». Deje un campo vacío si el rol no tiene ese objetivo.
      </p>
      {d.roles.map((rol) => (
        <ObjetivoDeRol
          key={rol}
          rol={rol}
          etiqueta={d.role_labels[rol] ?? rol}
          objetivo={d.targets[rol]}
          onGuardado={carga.recargar}
        />
      ))}
    </div>
  );
}

function ObjetivoDeRol({ rol, etiqueta, objetivo, onGuardado }) {
  const [valores, setValores] = useState(() =>
    Object.fromEntries(
      Object.keys(OBJETIVO).map((k) => [
        k,
        objetivo?.[k] != null ? String(objetivo[k]) : "",
      ]),
    ),
  );
  const [error, setError] = useState(null);
  const { guardar, guardando, avisos } = useGuardado();
  return (
    <Seccion titulo={etiqueta}>
      <ErrorEnLinea mensaje={error} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const objetivoNuevo = {};
          for (const k of Object.keys(OBJETIVO)) {
            const t = valores[k].trim();
            const n = Number(t.replace(",", "."));
            if (t && (!Number.isFinite(n) || n < 0 || n > 100)) {
              setError("Cada valor debe estar entre 0 y 100.");
              return;
            }
            objetivoNuevo[k] = t ? n : null;
          }
          setError(null);
          if (
            await guardar(
              rol,
              () => kpiService.guardarObjetivoDeRol(rol, objetivoNuevo),
              `Objetivo de ${etiqueta} guardado.`,
            )
          )
            onGuardado();
        }}
      >
        <div className="gk-campos">
          {Object.entries(OBJETIVO).map(([k, texto]) => (
            <Campo key={k} id={`gk-obj-${rol}-${k}`} etiqueta={texto}>
              <input
                type="number"
                min={0}
                max={100}
                className="form-control"
                value={valores[k]}
                placeholder="Sin objetivo"
                onChange={(e) =>
                  setValores((v) => ({ ...v, [k]: e.target.value }))
                }
              />
            </Campo>
          ))}
        </div>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={guardando === rol}
        >
          {guardando === rol ? "Guardando…" : "Guardar"}
        </button>
      </form>
      {avisos}
    </Seccion>
  );
}

// --- Matriz de compatibilidad ----------------------------------------------------------------

function Compatibilidad() {
  const carga = useCarga(
    () => kpiService.compatibilidad(),
    [],
    "No se pudo cargar la matriz.",
  );
  const d = carga.datos;
  if (!d) return <EstadoSeccion carga={carga} />;
  return (
    <div className="mz-stack">
      <p className="mz-small mb-0">
        A quién se puede redistribuir carga desde cada rol. Solo se ofrecen
        roles del mismo nivel jerárquico: entre niveles distintos nunca está
        permitido.
      </p>
      {d.roles.map((rol) => {
        const mismos = d.roles.filter(
          (r) => r !== rol && d.role_levels[r] === d.role_levels[rol],
        );
        return (
          <CompatibilidadDeRol
            key={rol}
            rol={rol}
            etiquetas={d.role_labels}
            opciones={mismos}
            elegidos={d.matrix[rol] ?? []}
            onGuardado={carga.recargar}
          />
        );
      })}
    </div>
  );
}

function CompatibilidadDeRol({
  rol,
  etiquetas,
  opciones,
  elegidos,
  onGuardado,
}) {
  const [marcados, setMarcados] = useState(elegidos);
  const { guardar, guardando, avisos } = useGuardado();
  const etiqueta = etiquetas[rol] ?? rol;
  const cambiado =
    [...marcados].sort().join("|") !== [...elegidos].sort().join("|");
  return (
    <Seccion titulo={etiqueta}>
      {opciones.length === 0 ? (
        <p className="mz-faint mb-0">No hay otros roles de su mismo nivel.</p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await guardar(
                rol,
                () => kpiService.guardarCompatibilidad(rol, marcados),
                `Compatibilidad de ${etiqueta} guardada.`,
              )
            )
              onGuardado();
          }}
        >
          <fieldset>
            <legend className="visually-hidden">
              Roles compatibles con {etiqueta}
            </legend>
            <ul className="gh-seleccion">
              {opciones.map((r) => (
                <li key={r}>
                  <label className="form-check">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={marcados.includes(r)}
                      onChange={() =>
                        setMarcados((l) =>
                          l.includes(r) ? l.filter((x) => x !== r) : [...l, r],
                        )
                      }
                    />
                    <span className="form-check-label">
                      {etiquetas[r] ?? r}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <button
            type="submit"
            className="btn btn-primary btn-sm mt-2"
            disabled={!cambiado || guardando === rol}
          >
            {guardando === rol ? "Guardando…" : "Guardar"}
          </button>
        </form>
      )}
      {avisos}
    </Seccion>
  );
}

// --- Fecha de inicio del KPI ---------------------------------------------------------------

function FechasDeInicio() {
  const carga = useCarga(
    () => kpiService.fechasDeInicio(),
    [],
    "No se pudieron cargar las personas.",
  );
  const personas = carga.datos;
  if (!personas) return <EstadoSeccion carga={carga} />;
  return (
    <Seccion titulo="Fecha de inicio del KPI">
      <p className="mz-small">
        Para quien entró a mitad de mes o cambió de funciones: sus KPI se
        calculan desde esa fecha. Sin fecha, desde el inicio de cada mes.
      </p>
      {personas.length === 0 ? (
        <p className="mz-empty mb-0">
          No hay personas con un rol de Gestión Humana en esta empresa.
        </p>
      ) : (
        <ul className="gk-lista">
          {personas.map((p) => (
            <FechaDePersona
              key={p.id}
              persona={p}
              onGuardado={carga.recargar}
            />
          ))}
        </ul>
      )}
    </Seccion>
  );
}

function FechaDePersona({ persona, onGuardado }) {
  const [fecha, setFecha] = useState(persona.kpi_start_date ?? "");
  const { guardar, guardando, avisos } = useGuardado();
  const id = `gk-inicio-${persona.id}`;
  const enviar = async (valor) => {
    if (
      await guardar(
        "fecha",
        () => kpiService.guardarFechaDeInicio(persona.id, valor),
        valor
          ? `Fecha de inicio de ${persona.name} guardada.`
          : `Fecha de inicio de ${persona.name} quitada.`,
        valor
          ? undefined
          : {
              titulo: `¿Quitar la fecha de inicio del KPI de ${persona.name}?`,
              mensaje:
                "Sus KPI vuelven a calcularse desde el inicio de cada mes.",
              accion: "Quitar la fecha",
            },
      )
    ) {
      setFecha(valor ?? "");
      onGuardado();
    }
  };
  return (
    <li className="gh-recuadro">
      <form
        className="gk-pie-form"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(fecha);
        }}
      >
        <div className="flex-grow-1">
          <label htmlFor={id} className="form-label mb-1">
            {persona.name}
          </label>
          <input
            id={id}
            type="date"
            className="form-control"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={
            guardando === "fecha" || fecha === (persona.kpi_start_date ?? "")
          }
        >
          Guardar
        </button>
        {persona.kpi_start_date && (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={guardando === "fecha"}
            onClick={() => enviar(null)}
          >
            Quitar la fecha
          </button>
        )}
      </form>
      {avisos}
    </li>
  );
}
