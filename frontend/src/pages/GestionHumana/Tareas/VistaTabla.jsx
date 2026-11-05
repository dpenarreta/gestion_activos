/*
 * Tabla de sus tareas (`TableView` de Nexo): una sección por estado
 * («Completadas» empieza contraída), orden por columna, selección para
 * exportar o eliminar varias, y el estado editable en la fila.
 *
 * En el teléfono queda fija una sola columna estrecha (la tarea, con su
 * casilla) y el resto se desplaza dentro de la tabla, nunca la página. Las
 * acciones de la fila van en «Más acciones» (⋯).
 */
import { useEffect, useMemo, useState } from "react";

import { confirmar } from "../../../components/common/Confirmar/confirmar";
import { Icon } from "../../../components/common/Icon/Icon";
import { descargarBlob } from "../../../utils/descargas";
import { MenuDeAcciones } from "../comunes";
import { BotonDeEstado, idFoco, useEnfocarTarea } from "./BotonDeEstado";
import { MarcaVencida, PillPrioridad } from "./Indicadores";
import { accionesDeTarea } from "./accionesDeTarea";
import {
  ESTADO,
  ESTADOS,
  FRECUENCIA,
  ICONO_ESTADO,
  claseDeColor,
  fechaCorta,
  hoy,
  horas,
  nombreDe,
  objetivoOficial,
  objetivoValidado,
  ordenar,
  vencida,
} from "./tareasComunes";

const COLUMNAS = [
  ["status", "Estado", false],
  ["priority", "Prioridad", true],
  ["frequency", "Frecuencia", true],
  ["start_date", "Inicio", true],
  ["end_date", "Fin", true],
  ["objetivo", "T. objetivo", true],
  ["real_hours", "H. reales", true],
  ["comment_count", "Coment.", true],
];

/** Texto seguro para una celda CSV (comillas y fórmulas de hoja de cálculo). */
function celda(valor) {
  let texto = String(valor ?? "");
  if (/^[=+\-@]/.test(texto)) texto = `'${texto}`;
  return `"${texto.replace(/"/g, '""')}"`;
}

export function exportarCSV(tareas) {
  const filas = [
    [
      "Título",
      "Descripción",
      "Estado",
      "Prioridad",
      "Frecuencia",
      "Fecha de inicio",
      "Fecha de fin",
      "Tiempo objetivo",
      "Horas reales",
      "Asignada a",
    ],
    ...tareas.map((t) => [
      t.title,
      t.description ?? "",
      ESTADO[t.status] ?? t.status,
      t.priority,
      FRECUENCIA[t.frequency] ?? t.frequency,
      fechaCorta(t.start_date),
      fechaCorta(t.end_date),
      // «6 h 30 min»: un «6.30» se leería como decimal en la hoja.
      horas(objetivoOficial(t)),
      horas(t.real_hours),
      nombreDe(t.assigned_to),
    ]),
  ];
  const texto = `\ufeff${filas.map((f) => f.map(celda).join(";")).join("\r\n")}`;
  descargarBlob(
    new Blob([texto], { type: "text/csv;charset=utf-8" }),
    `tareas_${hoy()}.csv`,
  );
}

function Seccion({
  estado,
  tareas,
  contexto,
  manejadores,
  seleccion,
  onAlternar,
  onAlternarTodas,
  orden,
  onOrdenar,
  foco,
}) {
  const [contraida, setContraida] = useState(estado === "COMPLETADA");
  // La tarea recién movida a esta sección tiene que verse para recibir el foco.
  useEffect(() => {
    if (foco && tareas.some((t) => t.id === foco.id)) setContraida(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foco]);
  const idTabla = `gt-t-${estado}`;
  const todas = tareas.length > 0 && tareas.every((t) => seleccion.has(t.id));
  return (
    <section className="gt-seccion" aria-labelledby={`${idTabla}-titulo`}>
      <h3 className="gt-seccion__titulo">
        <button
          type="button"
          className="gt-columna__plegar"
          aria-expanded={!contraida}
          aria-controls={idTabla}
          onClick={() => setContraida((c) => !c)}
        >
          <Icon name={contraida ? "chevron-right" : "chevron-down"} />
          <Icon name={ICONO_ESTADO[estado]} />
          <span id={`${idTabla}-titulo`}>{ESTADO[estado]}</span>
          <span className="gt-cuenta">
            {tareas.length}
            <span className="visually-hidden"> tareas</span>
          </span>
        </button>
      </h3>
      <div id={idTabla} hidden={contraida}>
        {tareas.length === 0 ? (
          <p className="mz-empty mb-0">Sin tareas en esta sección.</p>
        ) : (
          <div className="mz-table-wrap gt-tabla-wrap">
            <table className="mz-table gt-tabla">
              <caption className="visually-hidden">
                Tareas en estado {ESTADO[estado]}
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="gt-fija"
                    aria-sort={
                      orden.clave === "title"
                        ? orden.sentido === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                  >
                    <span className="gt-fija__contenido">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={todas}
                        onChange={() => onAlternarTodas(tareas, todas)}
                        aria-label={`Seleccionar todas las tareas en ${ESTADO[estado]}`}
                      />
                      <button
                        type="button"
                        className="gt-orden"
                        onClick={() => onOrdenar("title")}
                      >
                        Tarea
                        {orden.clave === "title" && (
                          <Icon
                            name={
                              orden.sentido === "asc"
                                ? "arrow-up"
                                : "arrow-down"
                            }
                          />
                        )}
                      </button>
                    </span>
                  </th>
                  {COLUMNAS.map(([clave, texto, ordenable]) => (
                    <th
                      key={clave}
                      scope="col"
                      className={
                        ["objetivo", "real_hours", "comment_count"].includes(
                          clave,
                        )
                          ? "num"
                          : undefined
                      }
                      aria-sort={
                        orden.clave === clave
                          ? orden.sentido === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                    >
                      {ordenable ? (
                        <button
                          type="button"
                          className="gt-orden"
                          onClick={() => onOrdenar(clave)}
                        >
                          {texto}
                          {orden.clave === clave && (
                            <Icon
                              name={
                                orden.sentido === "asc"
                                  ? "arrow-up"
                                  : "arrow-down"
                              }
                            />
                          )}
                        </button>
                      ) : (
                        texto
                      )}
                    </th>
                  ))}
                  <th scope="col">
                    <span className="visually-hidden">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tareas.map((t) => {
                  const esResponsable =
                    t.assigned_to?.id === contexto.usuarioId;
                  return (
                    <tr key={t.id} className={claseDeColor(t.color)}>
                      <th scope="row" className="gt-fija">
                        <span className="gt-fija__contenido">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={seleccion.has(t.id)}
                            onChange={() => onAlternar(t.id)}
                            aria-label={`Seleccionar «${t.title}»`}
                          />
                          <span className="gt-fija__texto">
                            <span
                              id={idFoco(t.id)}
                              className="gt-fija__titulo"
                              tabIndex={-1}
                            >
                              {t.title}
                            </span>
                            {!esResponsable && (
                              <span className="mz-small mz-faint">
                                {nombreDe(t.assigned_to)}
                              </span>
                            )}
                          </span>
                        </span>
                      </th>
                      <td>
                        {esResponsable ? (
                          <BotonDeEstado
                            tarea={t}
                            onMover={manejadores.mover}
                          />
                        ) : (
                          ESTADO[t.status]
                        )}
                      </td>
                      <td>
                        <PillPrioridad prioridad={t.priority} />
                      </td>
                      <td>{FRECUENCIA[t.frequency] ?? t.frequency}</td>
                      <td>{fechaCorta(t.start_date)}</td>
                      <td>
                        <span
                          className={vencida(t) ? "gt-texto--bad" : undefined}
                        >
                          {fechaCorta(t.end_date)}
                        </span>{" "}
                        {vencida(t) && <MarcaVencida />}
                      </td>
                      <td className="num">
                        {horas(objetivoOficial(t))}
                        {objetivoValidado(t) && (
                          <span className="gt-texto--ok">
                            {" "}
                            <Icon name="check-circle" />
                            <span className="visually-hidden"> validado</span>
                          </span>
                        )}
                      </td>
                      <td className="num">{horas(t.real_hours)}</td>
                      <td className="num">
                        {t.comment_count ?? 0}
                        {t.has_unread_comments && (
                          <span className="gt-nuevo"> nuevos</span>
                        )}
                      </td>
                      <td>
                        <MenuDeAcciones
                          etiqueta={`Más acciones de «${t.title}»`}
                          acciones={accionesDeTarea(t, contexto, manejadores)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export function VistaTabla({
  tareas,
  contexto,
  manejadores,
  onEliminarVarias,
  foco,
}) {
  const [orden, setOrden] = useState({ clave: null, sentido: "asc" });
  useEnfocarTarea(foco, tareas);
  const [seleccion, setSeleccion] = useState(() => new Set());
  const ordenadas = useMemo(
    () => ordenar(tareas, orden.clave, orden.sentido),
    [tareas, orden],
  );
  // Lo seleccionado que sigue en la lista (al filtrar o borrar, se cae solo).
  const elegidas = tareas.filter((t) => seleccion.has(t.id));

  function ordenarPor(clave) {
    setOrden((o) =>
      o.clave === clave
        ? { clave, sentido: o.sentido === "asc" ? "desc" : "asc" }
        : { clave, sentido: "asc" },
    );
  }

  function alternar(id) {
    setSeleccion((s) => {
      const nueva = new Set(s);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
  }

  function alternarTodas(lista, todas) {
    setSeleccion((s) => {
      const nueva = new Set(s);
      lista.forEach((t) => (todas ? nueva.delete(t.id) : nueva.add(t.id)));
      return nueva;
    });
  }

  async function eliminarElegidas() {
    const propias = elegidas.filter(
      (t) =>
        t.created_by?.id === contexto.usuarioId ||
        contexto.administra ||
        (contexto.valida && t.assigned_to?.id !== contexto.usuarioId),
    );
    const otras = elegidas.length - propias.length;
    if (!propias.length) {
      await confirmar({
        titulo: "No puede eliminar las tareas seleccionadas",
        mensaje:
          "Solo quien creó la tarea, su líder o quien administra Tareas puede eliminarla.",
        accion: "Entendido",
        peligro: false,
      });
      return;
    }
    const seguir = await confirmar({
      titulo: `¿Eliminar ${propias.length} tarea${propias.length === 1 ? "" : "s"}?`,
      mensaje: `Se eliminan con sus actividades y comentarios, y no se puede deshacer.${
        otras
          ? ` ${otras} de las seleccionadas no son suyas para eliminar y se dejarán como están.`
          : ""
      }`,
      accion: "Eliminar",
    });
    if (!seguir) return;
    await onEliminarVarias(propias);
    setSeleccion(new Set());
  }

  return (
    <div className="gt-tabla-vista">
      {elegidas.length > 0 && (
        <div
          className="gt-barra-seleccion"
          role="region"
          aria-label="Tareas seleccionadas"
        >
          <strong>
            {elegidas.length} seleccionada{elegidas.length === 1 ? "" : "s"}
          </strong>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => exportarCSV(elegidas)}
          >
            <Icon name="download" /> Exportar a CSV
          </button>
          <button
            type="button"
            className="btn btn-outline-danger btn-sm"
            onClick={eliminarElegidas}
          >
            <Icon name="trash" /> Eliminar seleccionadas
          </button>
          <button
            type="button"
            className="btn btn-link btn-sm"
            onClick={() => setSeleccion(new Set())}
          >
            Quitar selección
          </button>
        </div>
      )}
      {ESTADOS.map((estado) => (
        <Seccion
          key={estado}
          estado={estado}
          tareas={ordenadas.filter((t) => t.status === estado)}
          contexto={contexto}
          manejadores={manejadores}
          seleccion={seleccion}
          onAlternar={alternar}
          onAlternarTodas={alternarTodas}
          orden={orden}
          onOrdenar={ordenarPor}
          foco={foco}
        />
      ))}
    </div>
  );
}
