/*
 * Gantt de sus tareas (`GanttView` de Nexo): una barra por tarea, del inicio
 * al fin, con el avance dentro y la línea de hoy. La columna de la tarea
 * queda fija y estrecha; la línea de tiempo se desplaza dentro del gráfico,
 * nunca la página. Cada barra dice en texto sus fechas, su estado y su
 * avance (no solo con color). Los estilos en línea son solo la posición y el
 * ancho de cada barra, que dependen de las fechas.
 */
import { useMemo } from "react";

import { Icon } from "../../../components/common/Icon/Icon";
import {
  ESTADO,
  ICONO_ESTADO,
  diaUTC,
  diasEntre,
  fechaCorta,
  hoy,
  nombreDe,
  sumarDias,
  vencida,
} from "./tareasComunes";

const PX_POR_DIA = 28;
const MESES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/** Los lunes del rango (cada marca de la cabecera es una semana). */
function semanas(desde, hasta) {
  const [y, m, d] = desde.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  let cursor = sumarDias(desde, -((dow + 6) % 7));
  const lista = [];
  while (cursor <= hasta) {
    lista.push(cursor);
    cursor = sumarDias(cursor, 7);
  }
  return lista;
}

export function VistaGantt({ tareas, usuarioId, onAbrir }) {
  const rango = useMemo(() => {
    const dias = tareas.flatMap((t) => [
      diaUTC(t.start_date),
      diaUTC(t.end_date),
    ]);
    const desde = sumarDias(
      dias.reduce((a, b) => (b < a ? b : a)),
      -3,
    );
    let hasta = sumarDias(
      dias.reduce((a, b) => (b > a ? b : a)),
      3,
    );
    if (diasEntre(desde, hasta) < 14) hasta = sumarDias(desde, 14);
    return { desde, hasta, total: diasEntre(desde, hasta) + 1 };
  }, [tareas]);

  const ancho = rango.total * PX_POR_DIA;
  const hoyDia = hoy();
  const desplazamientoHoy = diasEntre(rango.desde, hoyDia);
  const hoyVisible = desplazamientoHoy >= 0 && desplazamientoHoy < rango.total;

  return (
    <div className="gt-gantt-wrap">
      <table className="gt-gantt">
        <caption className="visually-hidden">
          Cronograma de las tareas, del {fechaCorta(rango.desde)} al{" "}
          {fechaCorta(rango.hasta)}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="gt-gantt__tarea">
              Tarea
            </th>
            <th scope="col" className="gt-gantt__tiempo">
              <div className="gt-gantt__pista" style={{ width: ancho }}>
                {semanas(rango.desde, rango.hasta).map((s) => {
                  const [, m, d] = s.split("-").map(Number);
                  return (
                    <span
                      key={s}
                      className="gt-gantt__semana"
                      style={{ left: diasEntre(rango.desde, s) * PX_POR_DIA }}
                    >
                      {d} {MESES[m - 1]}
                    </span>
                  );
                })}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {tareas.map((t) => {
            const inicio = diaUTC(t.start_date);
            const fin = diaUTC(t.end_date);
            const izquierda = diasEntre(rango.desde, inicio) * PX_POR_DIA;
            const largo = Math.max(diasEntre(inicio, fin) + 1, 1) * PX_POR_DIA;
            const descripcion = `Del ${fechaCorta(inicio)} al ${fechaCorta(fin)} · ${ESTADO[t.status]} · ${t.progress ?? 0} % de avance${vencida(t) ? " · vencida" : ""}`;
            return (
              <tr key={t.id}>
                <th scope="row" className="gt-gantt__tarea">
                  <button
                    type="button"
                    className="gt-gantt__abrir"
                    onClick={() => onAbrir?.(t)}
                    title="Ver sus actividades"
                  >
                    <span className="gt-gantt__titulo">{t.title}</span>
                    <span className="mz-small mz-faint gt-gantt__sub">
                      {t.assigned_to?.id === usuarioId
                        ? `${fechaCorta(inicio)} → ${fechaCorta(fin)}`
                        : nombreDe(t.assigned_to)}
                    </span>
                  </button>
                </th>
                <td className="gt-gantt__tiempo">
                  <div className="gt-gantt__pista" style={{ width: ancho }}>
                    {hoyVisible && (
                      <span
                        className="gt-gantt__hoy"
                        style={{
                          left: desplazamientoHoy * PX_POR_DIA + PX_POR_DIA / 2,
                        }}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`gt-gantt__barra gt-gantt__barra--${t.status.toLowerCase()}${vencida(t) ? " gt-gantt__barra--vencida" : ""}`}
                      style={{ left: izquierda, width: largo }}
                      title={`${t.title}: ${descripcion}`}
                    >
                      <span
                        className="gt-gantt__avance"
                        style={{ width: `${Math.min(100, t.progress ?? 0)}%` }}
                        aria-hidden="true"
                      />
                      <span className="gt-gantt__etiqueta">
                        <Icon name={ICONO_ESTADO[t.status]} />
                        <span className="visually-hidden">{descripcion}</span>
                        <span aria-hidden="true">{t.title}</span>
                      </span>
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="gh-leyenda mt-2" aria-hidden="true">
        {[
          ["pendiente", "Pendiente"],
          ["en_progreso", "En progreso"],
          ["completada", "Completada"],
          ["pendiente gt-gantt__barra--vencida", "Vencida"],
        ].map(([clase, texto]) => (
          <span key={texto}>
            <span
              className={`gt-gantt__barra gt-gantt__muestra gt-gantt__barra--${clase}`}
            />{" "}
            {texto}
          </span>
        ))}
        <span>
          <span className="gt-gantt__muestra gt-gantt__hoy-muestra" /> Hoy
        </span>
      </p>
    </div>
  );
}
