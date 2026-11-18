import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { interaccionService } from "../../../api/interaccionService";
import { mensajeDeError } from "../../../utils/errores";
import "./InteraccionPlataforma.css";

/** El id del dashboard en el módulo (igual que en el servidor). */
export const DASHBOARD_INTERACCION = "interaccion-plataforma";

const PERIODOS = [
  [1, "Hoy"],
  [7, "7 días"],
  [30, "30 días"],
  [90, "90 días"],
];

const numero = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 1 });

/** «95 min» o «2 h 15 min». */
export function duracion(minutos) {
  const total = Math.round(Number(minutos) || 0);
  if (total < 60) return `${total} min`;
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

/** «18/11» de una fecha AAAA-MM-DD, sin pasar por la zona horaria. */
function diaCorto(iso) {
  const [, mes, dia] = String(iso).split("-");
  return `${dia}/${mes}`;
}

function fechaLarga(iso) {
  if (!iso) return "";
  const [anio, mes, dia] = String(iso).split("-");
  return `${dia}/${mes}/${anio}`;
}

function Indicador({ titulo, valor, detalle }) {
  return (
    <div className="kpi-card interaccion-kpi">
      <div className="kpi-card__label">{titulo}</div>
      <div className="kpi-card__value">{valor}</div>
      {detalle && <div className="kpi-card__sub">{detalle}</div>}
    </div>
  );
}

/** Un gráfico de barras por día, de una sola serie, con su tabla para quien
 * no ve el gráfico. */
function BarrasPorDia({ titulo, descripcion, serie, campo, unidad }) {
  const datos = serie.map((d) => ({
    ...d,
    etiqueta: diaCorto(d.fecha),
  }));
  return (
    <figure className="mz-card interaccion-grafico">
      <figcaption>
        <h2 className="interaccion-titulo">{titulo}</h2>
        {descripcion && <p className="mz-small mz-faint mb-2">{descripcion}</p>}
      </figcaption>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart
          accessibilityLayer
          data={datos}
          margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
        >
          <CartesianGrid
            stroke="var(--gridline)"
            strokeOpacity={0.35}
            vertical={false}
          />
          <XAxis
            dataKey="etiqueta"
            tick={{ fontSize: 11 }}
            interval="preserveStartEnd"
          />
          <YAxis width={40} tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "var(--gridline)", fillOpacity: 0.15 }}
            formatter={(valor) => [`${numero.format(valor)} ${unidad}`, titulo]}
            labelFormatter={(_, payload) =>
              fechaLarga(payload?.[0]?.payload?.fecha)
            }
          />
          <Bar
            dataKey={campo}
            fill="var(--series-1)"
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
          />
        </BarChart>
      </ResponsiveContainer>
      <details className="mt-2">
        <summary className="interaccion-resumen-tabla">
          Ver los datos en tabla
        </summary>
        <div className="table-scroll">
          <table className="table table-sm mt-2 mb-0 interaccion-tabla">
            <caption className="visually-hidden">{titulo} por día</caption>
            <thead>
              <tr>
                <th scope="col">Día</th>
                <th scope="col" className="text-end">
                  {titulo}
                </th>
              </tr>
            </thead>
            <tbody>
              {serie.map((d) => (
                <tr key={d.fecha}>
                  <td>{fechaLarga(d.fecha)}</td>
                  <td className="text-end">{numero.format(d[campo])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function Funcionalidades({ lista }) {
  const maximo = Math.max(1, ...lista.map((f) => f.minutos));
  return (
    <section className="mz-card interaccion-grafico">
      <h2 className="interaccion-titulo">Funcionalidades usadas</h2>
      <p className="mz-small mz-faint mb-2">
        Las pantallas donde se trabajó, en minutos de uso activo, y cuántas
        personas las usaron.
      </p>
      {lista.length === 0 ? (
        <p className="mz-faint mb-0">
          Todavía no hay actividad registrada en el periodo.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="table table-sm mb-0 interaccion-tabla">
            <caption className="visually-hidden">
              Funcionalidades usadas
            </caption>
            <thead>
              <tr>
                <th scope="col">Funcionalidad</th>
                <th
                  scope="col"
                  className="interaccion-barra-col"
                  aria-hidden="true"
                />
                <th scope="col" className="text-end">
                  Minutos
                </th>
                <th scope="col" className="text-end">
                  Personas
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.nombre}>
                  <td>{f.nombre}</td>
                  <td className="interaccion-barra-col" aria-hidden="true">
                    <span
                      className="interaccion-barra"
                      style={{ width: `${(f.minutos / maximo) * 100}%` }}
                    />
                  </td>
                  <td className="text-end">{numero.format(f.minutos)}</td>
                  <td className="text-end">{numero.format(f.personas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Recurrentes({ lista }) {
  return (
    <section className="mz-card interaccion-grafico">
      <h2 className="interaccion-titulo">Usuarios recurrentes (top 10)</h2>
      <p className="mz-small mz-faint mb-2">
        Quienes más veces entran en el día. Un regreso cuenta como otro ingreso
        tras 30 minutos sin actividad.
      </p>
      {lista.length === 0 ? (
        <p className="mz-faint mb-0">
          Todavía no hay conexiones registradas en el periodo.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="table table-sm mb-0 interaccion-tabla">
            <caption className="visually-hidden">Usuarios recurrentes</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span aria-hidden="true">#</span>
                  <span className="visually-hidden">Posición</span>
                </th>
                <th scope="col">Persona</th>
                <th scope="col" className="text-end">
                  Ingresos
                </th>
                <th scope="col" className="text-end">
                  Por día
                </th>
                <th scope="col" className="text-end">
                  Días
                </th>
                <th scope="col" className="text-end">
                  Conectado
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p, i) => (
                <tr key={`${p.nombre}-${i}`}>
                  <td>{i + 1}</td>
                  <td>{p.nombre}</td>
                  <td className="text-end">{numero.format(p.ingresos)}</td>
                  <td className="text-end">
                    {numero.format(p.ingresos_por_dia)}
                  </td>
                  <td className="text-end">{p.dias}</td>
                  <td className="text-end">{duracion(p.minutos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SinIngreso({ datos }) {
  const { nunca, en_periodo: enPeriodo, personas } = datos;
  return (
    <section className="mz-card interaccion-grafico">
      <h2 className="interaccion-titulo">Usuarios que no han ingresado</h2>
      <p className="mz-small mz-faint mb-2">
        {nunca === 1
          ? "1 cuenta activa nunca ha ingresado"
          : `${nunca} cuentas activas nunca han ingresado`}
        {" · "}
        {enPeriodo === 1
          ? "1 no ingresó en el periodo"
          : `${enPeriodo} no ingresaron en el periodo`}
        .
      </p>
      {personas.length === 0 ? (
        <p className="mz-faint mb-0">
          Todas las cuentas activas ya ingresaron alguna vez.
        </p>
      ) : (
        // Una zona con desplazamiento propio: enfocable para recorrerla con
        // el teclado (WCAG 2.1.1; Safari no la enfoca sola).
        /* eslint-disable jsx-a11y/no-noninteractive-tabindex */
        <div
          className="interaccion-desplazable"
          tabIndex={0}
          role="region"
          aria-label="Cuentas que nunca han ingresado"
        >
          <table className="table table-sm mb-0 interaccion-tabla">
            <caption className="visually-hidden">
              Cuentas que nunca han ingresado
            </caption>
            <thead>
              <tr>
                <th scope="col">Persona</th>
                <th scope="col">Correo</th>
                <th scope="col" className="text-end">
                  Cuenta creada
                </th>
              </tr>
            </thead>
            <tbody>
              {personas.map((p, i) => (
                <tr key={`${p.correo}-${i}`}>
                  <td>{p.nombre || "Sin nombre"}</td>
                  <td className="interaccion-correo">{p.correo}</td>
                  <td className="text-end">{fechaLarga(p.creada)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        /* eslint-enable jsx-a11y/no-noninteractive-tabindex */
      )}
    </section>
  );
}

/**
 * Dashboard «Interacción de la plataforma» (18/11/2026): cuántas personas se
 * conectan por día frente a las cuentas activas, el tiempo de actividad y de
 * conexión, los mensajes del chat, los usuarios recurrentes, quién no ha
 * ingresado y las funcionalidades más usadas. Lo calcula el servidor con el
 * registro diario de `apps.interaccion`; el acceso es el de cualquier
 * dashboard (dueño, superusuario y los roles con «Ver» o «Editar»).
 */
export default function InteraccionPlataformaPage() {
  const [dias, setDias] = useState(7);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError("");
    Promise.resolve()
      .then(() => interaccionService.resumen(dias))
      .then((d) => vigente && setDatos(d))
      .catch((e) => {
        if (!vigente) return;
        // Sin las cifras del periodo anterior: junto al error se leerían
        // como si fueran del periodo elegido (auditoría UX/UI).
        setDatos(null);
        setError(mensajeDeError(e, "No se pudo cargar el dashboard."));
      })
      .finally(() => vigente && setCargando(false));
    return () => {
      vigente = false;
    };
  }, [dias, intento]);

  const porcentaje =
    datos && datos.cuentas_activas
      ? Math.round((datos.personas_promedio_dia / datos.cuentas_activas) * 100)
      : 0;

  return (
    <div className="interaccion">
      <nav className="mz-small mb-2" aria-label="Ruta">
        <Link to="/admin/dashboards">Mis dashboards</Link>
      </nav>
      <header className="interaccion-cabecera">
        <div>
          <h1 className="h4 mb-1">Interacción de la plataforma</h1>
          <p className="mz-small mz-faint mb-0">
            Uso de la intranet calculado por el sistema.
            {datos?.registro_desde &&
              ` Registro de actividad desde el ${fechaLarga(datos.registro_desde)}.`}
          </p>
        </div>
        <div
          className="btn-group interaccion-periodo"
          role="group"
          aria-label="Periodo"
        >
          {PERIODOS.map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              className={`btn ${dias === valor ? "btn-primary" : "btn-outline-primary"}`}
              aria-pressed={dias === valor}
              onClick={() => setDias(valor)}
            >
              {texto}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div
          className="alert alert-danger d-flex flex-wrap align-items-center gap-2"
          role="alert"
        >
          <span>{error}</span>
          <button
            type="button"
            className="btn btn-outline-danger btn-sm ms-auto"
            onClick={() => setIntento((n) => n + 1)}
          >
            Reintentar
          </button>
        </div>
      )}
      {/* El aviso de carga, también al cambiar de periodo (auditoría UX/UI). */}
      <p className="visually-hidden" role="status">
        {cargando
          ? "Cargando…"
          : datos
            ? `Mostrando ${PERIODOS.find(([v]) => v === dias)?.[1] ?? ""}.`
            : ""}
      </p>
      {cargando && (
        <p className="mz-faint mz-small" aria-hidden="true">
          <span
            className="spinner-border spinner-border-sm me-2"
            aria-hidden="true"
          />
          Cargando…
        </p>
      )}

      {datos && (
        <div
          aria-busy={cargando}
          className={cargando ? "interaccion-cargando" : undefined}
        >
          <div className="interaccion-kpis">
            <Indicador
              titulo="Personas conectadas por día"
              valor={`${numero.format(datos.personas_promedio_dia)} de ${numero.format(datos.cuentas_activas)}`}
              detalle={`Promedio frente a las cuentas activas (${porcentaje} %). Hoy: ${datos.personas_hoy}.`}
            />
            <Indicador
              titulo="Tiempo promedio de actividad"
              valor={duracion(datos.minutos_activo_promedio)}
              detalle={`Por persona y día, con clics o teclado. Conectado: ${duracion(datos.minutos_conexion_promedio)}.`}
            />
            <Indicador
              titulo="Mensajes enviados por día"
              valor={numero.format(datos.mensajes.promedio_dia)}
              detalle={`${numero.format(datos.mensajes.promedio_persona_dia)} por persona conectada · ${numero.format(datos.mensajes.total)} en el periodo.`}
            />
            <Indicador
              titulo="Conexión máxima"
              valor={
                datos.conexion_maxima
                  ? duracion(datos.conexion_maxima.minutos)
                  : "—"
              }
              detalle={
                datos.conexion_maxima
                  ? `${datos.conexion_maxima.nombre} · ${fechaLarga(datos.conexion_maxima.fecha)}`
                  : "Sin conexiones en el periodo."
              }
            />
            <Indicador
              titulo="Conexión mínima"
              valor={
                datos.conexion_minima
                  ? duracion(datos.conexion_minima.minutos)
                  : "—"
              }
              detalle={
                datos.conexion_minima
                  ? `${datos.conexion_minima.nombre} · ${fechaLarga(datos.conexion_minima.fecha)}`
                  : "Sin conexiones en el periodo."
              }
            />
            <Indicador
              titulo="Nunca han ingresado"
              valor={numero.format(datos.sin_ingreso.nunca)}
              detalle={`De ${numero.format(datos.cuentas_activas)} cuentas activas.`}
            />
          </div>

          {datos.periodo.dias === 1 && (
            <p className="mz-small mz-faint">
              Los gráficos por día se muestran con 7 días o más.
            </p>
          )}
          {datos.periodo.dias > 1 && (
            <div className="interaccion-fila">
              <BarrasPorDia
                titulo="Personas conectadas"
                descripcion={`Por día. Hay ${numero.format(datos.cuentas_activas)} cuentas activas.`}
                serie={datos.serie}
                campo="personas"
                unidad="personas"
              />
              <BarrasPorDia
                titulo="Mensajes enviados"
                descripcion="Mensajes del chat por día."
                serie={datos.serie}
                campo="mensajes"
                unidad="mensajes"
              />
            </div>
          )}

          <div className="interaccion-fila">
            <Recurrentes lista={datos.recurrentes} />
            <Funcionalidades lista={datos.funcionalidades} />
          </div>

          <SinIngreso datos={datos.sin_ingreso} />
        </div>
      )}
    </div>
  );
}
