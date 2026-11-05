/*
 * Gráficos de Desempeño con Recharts (la librería que ya usa la intranet en
 * Dashboards). Cada uno lleva un resumen en texto y su tabla equivalente
 * («Ver los datos en tabla»); el dibujo queda oculto para los lectores de
 * pantalla, que leen la tabla. Los colores salen de los tokens de la
 * identidad y nunca van solos: la tabla dice la zona de cada valor.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useEffect, useState } from "react";

import { DIA_HISTORIAL, etiquetaDeMes, horas, numero } from "./kpiComunes";

// Colores con contraste suficiente contra la tarjeta; nunca van solos (la
// tabla y el resumen dicen la zona).
const COLOR = {
  green: "var(--mz-ok-fg)",
  yellow: "var(--mz-warn-fg)",
  orange: "var(--mz-warn-fg)",
  red: "var(--mz-bad-fg)",
  blue: "var(--mz-info-fg)",
  gray: "var(--mz-ink-faint)",
};

const TONO_DE_COLOR = {
  green: "ok",
  yellow: "warn",
  orange: "warn",
  red: "bad",
  blue: "info",
};

const EJE = { fontSize: 11, fill: "var(--mz-ink-faint)" };
const TOOLTIP = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid var(--mz-border)",
    background: "var(--mz-raised)",
    color: "var(--mz-ink)",
    fontSize: 12,
  },
};

/** El marco común: título, resumen, dibujo (oculto al lector) y tabla. */
export function Grafico({ titulo, resumen, alto = 220, tabla, children }) {
  return (
    <figure className="gk-grafico">
      {titulo && (
        <figcaption className="gk-grafico__titulo">{titulo}</figcaption>
      )}
      {resumen && <p className="mz-small mz-faint mb-2">{resumen}</p>}
      <div
        className="gk-grafico__lienzo"
        aria-hidden="true"
        style={{ height: alto }}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
      {tabla && (
        <details className="gk-datos">
          <summary>Ver los datos en tabla</summary>
          <div className="mz-table-wrap">{tabla}</div>
        </details>
      )}
    </figure>
  );
}

function Tabla({ titulo, columnas, filas }) {
  return (
    <table className="mz-table gk-tabla-datos">
      <caption className="visually-hidden">{titulo}</caption>
      <thead>
        <tr>
          {columnas.map((c, i) => (
            <th key={c} scope="col" className={i ? "num" : undefined}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f[0]}>
            <th scope="row">{f[0]}</th>
            {f.slice(1).map((v, i) => (
              <td key={i} className="num">
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Evolución del cumplimiento, con las líneas de 80 % (meta) y 60 %
 * (alerta). `datos`: `[{ label, completed_pct }]`. */
export function LineaDeCumplimiento({
  datos,
  titulo = "Evolución del cumplimiento",
}) {
  if (!datos?.length) return null;
  datos = datos.map((d) => ({
    ...d,
    label: d.month ? etiquetaDeMes(d.month) : d.label,
  }));
  const ultimo = datos[datos.length - 1];
  return (
    <Grafico
      titulo={titulo}
      resumen={`Último mes (${ultimo.label}): ${numero(ultimo.completed_pct)} %. Meta: 80 %; alerta bajo 60 %.`}
      tabla={
        <Tabla
          titulo={titulo}
          columnas={["Mes", "Cumplimiento"]}
          filas={datos.map((d) => [d.label, `${numero(d.completed_pct)} %`])}
        />
      }
    >
      <LineChart
        data={datos}
        margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--mz-border)"
          vertical={false}
        />
        <XAxis dataKey="label" tick={EJE} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={EJE} axisLine={false} tickLine={false} />
        <Tooltip
          {...TOOLTIP}
          formatter={(v) => [`${numero(v)} %`, "Cumplimiento"]}
        />
        <ReferenceLine y={80} stroke={COLOR.green} strokeDasharray="5 4" />
        <ReferenceLine y={60} stroke={COLOR.yellow} strokeDasharray="5 4" />
        <Line
          type="monotone"
          dataKey="completed_pct"
          stroke="var(--mz-action)"
          strokeWidth={2.5}
          dot={{ r: 3 }}
        />
      </LineChart>
    </Grafico>
  );
}

/** Una serie de puntajes 0-100 (`[{ etiqueta, valor }]`). */
export function LineaDePuntaje({
  datos,
  nombre,
  titulo,
  dominio = [0, 100],
  unidad = "",
}) {
  if (!datos?.length) return null;
  const ultimo = datos[datos.length - 1];
  return (
    <Grafico
      titulo={titulo}
      resumen={`${datos.length} ${datos.length === 1 ? "punto" : "puntos"}; el último (${ultimo.etiqueta}): ${numero(ultimo.valor)}${unidad}.`}
      tabla={
        <Tabla
          titulo={titulo ?? nombre}
          columnas={["Fecha", nombre]}
          filas={datos.map((d, i) => [
            `${d.etiqueta}${datos.filter((x) => x.etiqueta === d.etiqueta).length > 1 ? ` (${i + 1})` : ""}`,
            `${numero(d.valor)}${unidad}`,
          ])}
        />
      }
    >
      <LineChart
        data={datos}
        margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--mz-border)"
          vertical={false}
        />
        <XAxis
          dataKey="etiqueta"
          tick={EJE}
          axisLine={false}
          tickLine={false}
        />
        <YAxis domain={dominio} tick={EJE} axisLine={false} tickLine={false} />
        <Tooltip
          {...TOOLTIP}
          formatter={(v) => [`${numero(v)}${unidad}`, nombre]}
        />
        <Line
          type="monotone"
          dataKey="valor"
          stroke="var(--mz-action)"
          strokeWidth={2.5}
          dot={{ r: 3 }}
        />
      </LineChart>
    </Grafico>
  );
}

function etiquetaDelDia(p, hoyDia) {
  if (p.date === hoyDia && (p.kind === "normal" || p.kind === "empty"))
    return "En curso";
  return DIA_HISTORIAL[p.kind] ?? p.label;
}

const SIN_HORAS = new Set([
  "holiday",
  "leave-medico",
  "leave-personal",
  "leave-vacaciones",
  "leave-generic",
]);

/** «6 h 30» en los ejes (corto); el detalle va en la tabla. */
const ejeHoras = (v) => {
  const total = Math.round((Number(v) || 0) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m}` : `${h} h`;
};

/** El día de hoy en el navegador (AAAA-MM-DD, local). */
function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Marca de un día sin horas que contar (feriado o ausencia): un recuadro
 * punteado con su inicial sobre el eje; nunca una barra de horas. */
function MarcaSinHoras({ x, y, width, index, datos }) {
  const p = datos?.[index];
  if (!p || !SIN_HORAS.has(p.kind)) return null;
  const cx = x + width / 2;
  const color = p.kind === "holiday" ? COLOR.gray : COLOR.blue;
  return (
    <g>
      <rect
        x={cx - 7}
        y={y - 16}
        width={14}
        height={14}
        rx={3}
        fill="none"
        stroke={color}
        strokeDasharray="2 2"
      />
      <text x={cx} y={y - 5} textAnchor="middle" fontSize={9} fill={color}>
        {p.kind === "holiday" ? "F" : "A"}
      </text>
    </g>
  );
}

/** Los días laborables del mes con sus horas reales y su zona. Los
 * feriados y las ausencias van con altura 0 y una marca («F», «A»); el día
 * de hoy, «En curso». */
export function BarrasDeCargaDiaria({ puntos, base, limiteOptimo }) {
  if (!puntos?.length) return null;
  const hoyDia = hoyLocal();
  const datos = puntos.map((p) => ({
    ...p,
    alto: SIN_HORAS.has(p.kind) ? 0 : p.real_hours,
  }));
  const conRegistro = puntos.filter((p) => p.real_hours > 0).length;
  const sinHoras = puntos.filter((p) => SIN_HORAS.has(p.kind)).length;
  const tope = Math.max(
    ...datos.map((p) => p.alto),
    (limiteOptimo || 0) * 1.1,
    (base || 0) * 1.1,
    1,
  );
  return (
    <Grafico
      titulo="Días laborables del mes"
      resumen={`${conRegistro} de ${puntos.length} días con horas registradas${sinHoras ? `; ${sinHoras} sin horas que contar (feriados o ausencias, marcados con F o A)` : ""}. Base diaria: ${horas(base)}; límite óptimo: ${horas(limiteOptimo)}.`}
      tabla={
        <Tabla
          titulo="Horas por día"
          columnas={["Día", "Horas reales", "Zona"]}
          filas={puntos.map((p) => [
            p.day_label,
            SIN_HORAS.has(p.kind) ? "—" : horas(p.real_hours),
            etiquetaDelDia(p, hoyDia) ?? "—",
          ])}
        />
      }
    >
      <BarChart
        data={datos}
        margin={{ top: 18, right: 12, left: 0, bottom: 4 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--mz-border)"
          vertical={false}
        />
        <XAxis
          dataKey="day_label"
          tick={EJE}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={EJE}
          axisLine={false}
          tickLine={false}
          width={52}
          domain={[0, tope]}
          tickFormatter={ejeHoras}
        />
        <Tooltip
          {...TOOLTIP}
          formatter={(_v, _n, item) => [
            SIN_HORAS.has(item.payload.kind)
              ? etiquetaDelDia(item.payload, hoyDia)
              : `${horas(item.payload.real_hours)} · ${etiquetaDelDia(item.payload, hoyDia) ?? "—"}`,
            "Horas",
          ]}
        />
        {base > 0 && (
          <ReferenceLine
            y={base}
            stroke="var(--mz-ink-faint)"
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
          />
        )}
        {limiteOptimo > 0 && (
          <ReferenceLine
            y={limiteOptimo}
            stroke={COLOR.green}
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
          />
        )}
        <Bar
          dataKey="alto"
          radius={[4, 4, 0, 0]}
          label={<MarcaSinHoras datos={datos} />}
        >
          {datos.map((p) => (
            <Cell
              key={p.date}
              fill={
                p.date === hoyDia
                  ? COLOR.gray
                  : p.kind === "weekend-extra"
                    ? "var(--mz-action)"
                    : (COLOR[p.color] ?? COLOR.gray)
              }
            />
          ))}
        </Bar>
      </BarChart>
    </Grafico>
  );
}

/** Las semanas del mes en curso. */
export function LineaDeCargaSemanal({ puntos, limiteOptimo }) {
  if (!puntos?.length) return null;
  const tope = Math.max(
    ...puntos.map((p) => p.real_hours),
    ...puntos.map((p) => p.base_hours),
    (limiteOptimo || 0) * 1.1,
    1,
  );
  return (
    <Grafico
      titulo="Semanas de este mes"
      resumen={`${puntos.length} ${puntos.length === 1 ? "semana" : "semanas"}. Límite óptimo de una semana completa: ${horas(limiteOptimo)}; la línea punteada gris es la base de cada semana.`}
      tabla={
        <Tabla
          titulo="Horas por semana"
          columnas={["Semana", "Horas reales", "Base", "Zona"]}
          filas={puntos.map((p) => [
            p.week_label,
            horas(p.real_hours),
            horas(p.base_hours),
            p.label,
          ])}
        />
      }
    >
      <LineChart
        data={puntos}
        margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--mz-border)"
          vertical={false}
        />
        <XAxis
          dataKey="week_label"
          tick={EJE}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={EJE}
          axisLine={false}
          tickLine={false}
          width={52}
          domain={[0, tope]}
          tickFormatter={ejeHoras}
        />
        <Tooltip
          {...TOOLTIP}
          formatter={(_v, n, item) => [
            n === "base_hours"
              ? horas(item.payload.base_hours)
              : `${horas(item.payload.real_hours)} · ${item.payload.label}`,
            n === "base_hours" ? "Base" : "Horas",
          ]}
        />
        {limiteOptimo > 0 && (
          <ReferenceLine
            y={limiteOptimo}
            stroke={COLOR.green}
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
          />
        )}
        <Line
          type="monotone"
          dataKey="base_hours"
          stroke="var(--mz-ink-faint)"
          strokeDasharray="4 4"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="real_hours"
          stroke="var(--mz-action)"
          strokeWidth={2.5}
          dot={{ r: 3 }}
        />
      </LineChart>
    </Grafico>
  );
}

/** Si la pantalla es de teléfono (los gráficos anchos pasan a lista). */
function useTelefono() {
  const consulta = "(max-width: 600px)";
  const [es, setEs] = useState(
    () =>
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.(consulta).matches),
  );
  useEffect(() => {
    const m = window.matchMedia?.(consulta);
    if (!m) return undefined;
    const cambiar = () => setEs(m.matches);
    m.addEventListener?.("change", cambiar);
    return () => m.removeEventListener?.("change", cambiar);
  }, []);
  return es;
}

/** La carga del equipo en el mes: horas reales frente a la base. En el
 * teléfono, una lista de barras en lugar del gráfico. */
export function BarrasDeCargaDelEquipo({ datos }) {
  const telefono = useTelefono();
  if (!datos?.length) return null;
  const total = datos.reduce((s, d) => s + (d.real_hours ?? 0), 0);
  const resumen = `${datos.length} ${datos.length === 1 ? "persona" : "personas"}; ${horas(total)} reales en total.`;
  if (telefono) {
    const maximo = Math.max(
      ...datos.map((d) => Math.max(d.real_hours, d.base_hours)),
      1,
    );
    return (
      <div>
        <p className="mz-small mz-faint">{resumen}</p>
        <ul className="gk-barras">
          {datos.map((d) => (
            <li key={d.id}>
              <span className="gk-barras__etiqueta">{d.name}</span>
              <span className="gh-avance gk-barras__barra" aria-hidden="true">
                <span
                  className={`gk-relleno--${TONO_DE_COLOR[d.color] ?? "neutral"}`}
                  style={{
                    width: `${Math.round((d.real_hours / maximo) * 100)}%`,
                  }}
                />
              </span>
              <span className="mz-small">
                {horas(d.real_hours)} de {horas(d.base_hours)}
                {d.label ? ` · ${d.label}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <Grafico
      titulo="Carga laboral del equipo este mes"
      resumen={`${resumen} La barra clara es la base esperada de cada persona.`}
      alto={Math.max(180, datos.length * 34)}
      tabla={
        <Tabla
          titulo="Carga del equipo"
          columnas={["Persona", "Horas reales", "Base", "Zona"]}
          filas={datos.map((d) => [
            d.name,
            horas(d.real_hours),
            horas(d.base_hours),
            d.label ?? "—",
          ])}
        />
      }
    >
      <BarChart
        data={datos}
        layout="vertical"
        margin={{ top: 4, right: 12, left: 8, bottom: 4 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--mz-border)"
          horizontal={false}
        />
        <XAxis
          type="number"
          tick={EJE}
          axisLine={false}
          tickLine={false}
          tickFormatter={ejeHoras}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={EJE}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          {...TOOLTIP}
          formatter={(v, n) => [
            horas(v),
            n === "base_hours" ? "Base" : "Reales",
          ]}
        />
        <Bar
          dataKey="base_hours"
          fill="var(--mz-ink-faint)"
          fillOpacity={0.35}
          stroke="var(--mz-ink-faint)"
        />
        <Bar dataKey="real_hours">
          {datos.map((d) => (
            <Cell key={d.id} fill={COLOR[d.color] ?? COLOR.gray} />
          ))}
        </Bar>
      </BarChart>
    </Grafico>
  );
}
