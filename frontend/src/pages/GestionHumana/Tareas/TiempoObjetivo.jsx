/*
 * Tiempo objetivo y validaciones (`RegularizeTargetTimeManager` de Nexo,
 * ruta `tiempo-objetivo`): el líder valida la planificación —Tiempo
 * Objetivo y Fecha Fin, cada uno por su lado— desde una sola lista. Nunca
 * toca las horas reales y la decisión siempre es de una persona.
 *
 * - Con `tareas.regularizar`: todas las tareas activas o recientes de la
 *   empresa que esperan validación (`validations/pending/`), la calidad del
 *   dato y las acciones en bloque.
 * - Con solo `tareas.validar`: las tareas de su equipo que esperan
 *   validación (desde Equipo), una por una.
 *
 * Nadie valida una tarea propia: el servidor la salta y aquí no se ofrece.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { errorDeTareas, tareasService } from "../../../api/tareasService";
import {
  Campo,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import {
  EQUIPO_VER,
  TAREAS_REGULARIZAR,
  TAREAS_VALIDAR,
} from "../../../modulos/permisosGestionHumana";
import { Aviso, ErrorEnLinea, MenuDeAcciones } from "../comunes";
import { ConAccesoTareas, Encabezado, useTareas } from "./ContextoTareas";
import { PreviaHoras, EstadoFechaFin, PillValidado } from "./Indicadores";
import { ValidarTarea } from "./ValidarTarea";
import { Ventana } from "./Ventanas";
import {
  AYUDA_HORAS,
  HORAS_INVALIDAS,
  MOTIVO_TIEMPO_OBJETIVO,
  ROL,
  TIPO,
  aMedianocheUTC,
  diaUTC,
  fechaCorta,
  horas,
  horasValidas,
  nombreDe,
  objetivoOficial,
  rolLegible,
  textoAHoras,
} from "./tareasComunes";

export function TiempoObjetivo() {
  return (
    <ConAccesoTareas
      titulo="Validaciones"
      permiso={[TAREAS_VALIDAR, TAREAS_REGULARIZAR]}
    >
      <PantallaTiempoObjetivo />
    </ConAccesoTareas>
  );
}

const rolDe = (persona) => persona?.role ?? persona?.roles?.[0]?.name ?? "";

const pendienteDeValidar = (t) =>
  t.target_time_validated === null ||
  t.target_time_validated === undefined ||
  t.end_date_approval_status === "PENDIENTE";

function Calidad({ titulo, calidad, etiquetaOk }) {
  if (!calidad) return null;
  return (
    <div className="mz-kpi">
      <div className="mz-kpi-label">{titulo}</div>
      <div className="mz-kpi-value">{calidad.validated_pct} %</div>
      <div className="mz-kpi-sub">
        {etiquetaOk}: {calidad.validated_count} de {calidad.total_count} ·
        pendientes: {calidad.pending_count} ({calidad.pending_pct} %)
      </div>
    </div>
  );
}

function RegularizarEnBloque({ ids, onCerrar, onHecho }) {
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  const panel = useRef(null);

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const e = {};
    if (!horasValidas(valor) || textoAHoras(valor) <= 0)
      e.new_value = HORAS_INVALIDAS;
    if (!motivo) e.reason = "Elija el motivo del ajuste.";
    if (motivo === "OTRO" && !detalle.trim())
      e.reason_detail = "Indique el detalle cuando el motivo es «Otro».";
    setErrores(e);
    setError(null);
    if (Object.keys(e).length) {
      enfocarPrimerError(panel.current);
      return;
    }
    enCurso.current = true;
    setGuardando(true);
    try {
      const r = await tareasService.validarEnBloque({
        task_ids: ids,
        new_value: textoAHoras(valor),
        reason: motivo,
        reason_detail: motivo === "OTRO" ? detalle.trim() : null,
      });
      onHecho(
        `Tiempo objetivo regularizado en ${r.updated_count} tarea(s).${
          r.skipped_self_assigned?.length
            ? ` Se omitieron ${r.skipped_self_assigned.length} propia(s).`
            : ""
        }`,
      );
    } catch (err) {
      const fallo = errorDeTareas(err, "No se pudo regularizar.");
      setErrores(fallo.campos);
      setError(fallo.mensaje);
      setGuardando(false);
      enCurso.current = false;
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo={`Regularizar tiempo objetivo de ${ids.length} tarea(s)`}
      subtitulo="Se aplica el mismo valor y el mismo motivo a todas; cada una queda en su historial."
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar={`Regularizar ${ids.length}`}
      isSaving={guardando}
    >
      <div ref={panel}>
        <Campo
          id="gt-bloque-valor"
          etiqueta="Nuevo tiempo objetivo (HH.MM)"
          obligatorio
          ayuda={AYUDA_HORAS}
          error={errores.new_value}
        >
          <input
            className="form-control"
            inputMode="decimal"
            placeholder="Ej.: 6.30"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </Campo>
        <PreviaHoras texto={valor} />
        <Campo
          id="gt-bloque-motivo"
          etiqueta="Motivo del ajuste"
          obligatorio
          error={errores.reason}
          className="mt-3"
        >
          <select
            className="form-select"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          >
            <option value="">Elija el motivo</option>
            {Object.entries(MOTIVO_TIEMPO_OBJETIVO).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </Campo>
        {motivo === "OTRO" && (
          <Campo
            id="gt-bloque-detalle"
            etiqueta="Detalle del motivo"
            obligatorio
            error={errores.reason_detail}
            className="mt-3"
          >
            <textarea
              className="form-control"
              rows={2}
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
            />
          </Campo>
        )}
        <ErrorEnLinea mensaje={error} className="mt-3" />
      </div>
    </ModalDialog>
  );
}

/** Aprobación de Fecha Fin en bloque: se puede ajustar la fecha de cada una
 * antes de aprobar; si hay cambios, se listan para confirmar. */
function AprobarFechasEnBloque({ tareas, onCerrar, onHecho }) {
  const [fechas, setFechas] = useState(() =>
    Object.fromEntries(tareas.map((t) => [t.id, diaUTC(t.end_date)])),
  );
  const [observaciones, setObservaciones] = useState("");
  const [revisando, setRevisando] = useState(false);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);

  const invalidas = tareas.filter(
    (t) => !fechas[t.id] || fechas[t.id] < diaUTC(t.start_date),
  );
  const cambios = tareas.filter((t) => fechas[t.id] !== diaUTC(t.end_date));

  async function enviar() {
    if (enCurso.current) return;
    enCurso.current = true;
    setGuardando(true);
    setError(null);
    try {
      const r = await tareasService.aprobarFechasEnBloque({
        items: tareas.map((t) => ({
          task_id: t.id,
          new_end_date: aMedianocheUTC(fechas[t.id]),
        })),
        observaciones: observaciones.trim() || null,
      });
      const notas = [];
      if (r.skipped_self_assigned?.length)
        notas.push(`${r.skipped_self_assigned.length} propia(s) omitida(s).`);
      if (r.skipped_invalid_date?.length)
        notas.push(
          `${r.skipped_invalid_date.length} con fecha anterior al inicio omitida(s).`,
        );
      onHecho(
        `Fecha fin decidida en ${r.updated_count} tarea(s).${notas.length ? ` ${notas.join(" ")}` : ""}`,
      );
    } catch (err) {
      setError(errorDeTareas(err, "No se pudo aprobar en bloque.").mensaje);
      setGuardando(false);
      enCurso.current = false;
    }
  }

  function principal() {
    if (invalidas.length) {
      setError(
        "La fecha fin no puede quedar vacía ni ser anterior a la fecha de inicio. Corríjala en las filas marcadas.",
      );
      return;
    }
    setError(null);
    if (cambios.length && !revisando) setRevisando(true);
    else enviar();
  }

  return (
    <Ventana
      titulo={`Aprobar fecha fin de ${tareas.length} tarea(s)`}
      subtitulo="Revise la fecha de cada una. Si no la cambia, se aprueba la registrada por la persona responsable."
      onCerrar={onCerrar}
      ancha
      pie={
        <>
          <button
            type="button"
            className="btn btn-cancelar"
            onClick={revisando ? () => setRevisando(false) : onCerrar}
            disabled={guardando}
          >
            {revisando ? "Volver a revisar" : "Cancelar"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={principal}
            disabled={guardando}
          >
            {guardando
              ? "Guardando…"
              : revisando
                ? "Confirmar"
                : cambios.length
                  ? "Revisar cambios"
                  : `Aprobar ${tareas.length}`}
          </button>
        </>
      }
    >
      {!revisando ? (
        <>
          <div className="mz-table-wrap gt-tabla-wrap">
            <table className="mz-table gt-tabla">
              <caption className="visually-hidden">
                Fecha fin de las tareas seleccionadas
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="gt-fija">
                    Tarea
                  </th>
                  <th scope="col">Responsable</th>
                  <th scope="col">Inicio</th>
                  <th scope="col">Fin actual</th>
                  <th scope="col">Nueva fecha fin</th>
                </tr>
              </thead>
              <tbody>
                {tareas.map((t) => {
                  const mala = invalidas.includes(t);
                  return (
                    <tr key={t.id}>
                      <th scope="row" className="gt-fija">
                        <span className="gt-fija__titulo">{t.title}</span>
                      </th>
                      <td>{nombreDe(t.assigned_to)}</td>
                      <td>{fechaCorta(t.start_date)}</td>
                      <td>{fechaCorta(t.end_date)}</td>
                      <td>
                        <label
                          className="visually-hidden"
                          htmlFor={`gt-bloque-fecha-${t.id}`}
                        >
                          Nueva fecha fin de «{t.title}»
                        </label>
                        <input
                          id={`gt-bloque-fecha-${t.id}`}
                          type="date"
                          className={`form-control form-control-sm${mala ? " is-invalid" : ""}`}
                          aria-invalid={mala || undefined}
                          aria-describedby={
                            mala ? `gt-bloque-fecha-${t.id}-error` : undefined
                          }
                          min={diaUTC(t.start_date)}
                          value={fechas[t.id] ?? ""}
                          onChange={(e) =>
                            setFechas((f) => ({ ...f, [t.id]: e.target.value }))
                          }
                        />
                        {mala && (
                          <span
                            id={`gt-bloque-fecha-${t.id}-error`}
                            className="mz-field-error"
                          >
                            Anterior al inicio o vacía.
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Campo
            id="gt-bloque-observaciones"
            etiqueta="Observaciones"
            className="mt-3"
          >
            <textarea
              className="form-control"
              rows={2}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
            />
          </Campo>
        </>
      ) : (
        <>
          <p>
            {cambios.length === 1
              ? "1 tarea tendrá un cambio de fecha fin:"
              : `${cambios.length} tareas tendrán un cambio de fecha fin:`}
          </p>
          <ul>
            {cambios.map((t) => (
              <li key={t.id}>
                <strong>{t.title}</strong>: de {fechaCorta(t.end_date)} a{" "}
                {fechaCorta(fechas[t.id])}. Se avisará a{" "}
                {nombreDe(t.assigned_to)}.
              </li>
            ))}
          </ul>
          <p className="mb-0">
            Las demás se aprueban con la fecha que tienen. ¿Desea continuar?
          </p>
        </>
      )}
      <ErrorEnLinea mensaje={error} className="mt-3" />
    </Ventana>
  );
}

function PantallaTiempoObjetivo() {
  const { usuarioId, can } = useTareas();
  const regulariza = can(TAREAS_REGULARIZAR);
  const [filtros, setFiltros] = useState({ usuario: "", rol: "", tipo: "" });
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [personas, setPersonas] = useState([]);
  const [seleccion, setSeleccion] = useState(() => new Set());
  const [validando, setValidando] = useState(null);
  const [enBloque, setEnBloque] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(async () => {
    setError(null);
    setDatos(null);
    setSeleccion(new Set());
    try {
      if (regulariza) {
        setDatos(await tareasService.pendientes(filtros));
        return;
      }
      // Solo `tareas.validar`: las de su equipo, persona por persona.
      if (!can(EQUIPO_VER)) {
        setDatos({ tasks: [], sinEquipo: true });
        return;
      }
      const equipo = await tareasService.equipo();
      const listas = await Promise.all(
        equipo.map((p) => tareasService.tareasDe(p.id)),
      );
      setDatos({ tasks: listas.flat().filter(pendienteDeValidar) });
    } catch (err) {
      setError(
        errorDeTareas(err, "No se pudieron cargar las tareas por validar.")
          .mensaje,
      );
    }
    // `can` cambia de identidad con cada render del contexto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regulariza, filtros]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!regulariza) return;
    tareasService
      .asignables()
      .then((l) => setPersonas(Array.isArray(l) ? l : []))
      // El filtro por persona es una ayuda: sin la lista, queda «Todas».
      .catch(() => setPersonas([]));
  }, [regulariza]);

  const tareas = useMemo(() => datos?.tasks ?? [], [datos]);
  const elegibles = tareas.filter((t) => t.assigned_to?.id !== usuarioId);
  const elegidas = tareas.filter((t) => seleccion.has(t.id));
  const todas =
    elegibles.length > 0 && elegibles.every((t) => seleccion.has(t.id));

  function alternar(id) {
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const filtro = (campo) => (e) =>
    setFiltros((f) => ({ ...f, [campo]: e.target.value }));
  const hayFiltros = Boolean(filtros.usuario || filtros.rol || filtros.tipo);

  return (
    <div className="gh-page">
      <Encabezado
        titulo="Validaciones"
        descripcion="El líder valida la planificación de su equipo: el Tiempo Objetivo y la Fecha Fin, cada uno por su lado. Nunca se modifican las horas reales."
      />
      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      {regulariza &&
        (datos?.target_time_data_quality || datos?.end_date_data_quality) && (
          <div className="mz-kpi-grid">
            <Calidad
              titulo="Tiempo objetivo validado"
              calidad={datos.target_time_data_quality}
              etiquetaOk="Validadas"
            />
            <Calidad
              titulo="Fecha fin decidida"
              calidad={datos.end_date_data_quality}
              etiquetaOk="Decididas"
            />
          </div>
        )}

      {regulariza && (
        <div className="gh-alcance" role="group" aria-label="Filtros">
          <div className="mz-campo">
            <label className="form-label" htmlFor="gt-to-persona">
              Colaborador
            </label>
            <select
              id="gt-to-persona"
              className="form-select form-select-sm"
              value={filtros.usuario}
              onChange={filtro("usuario")}
            >
              <option value="">Todas las personas</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mz-campo">
            <label className="form-label" htmlFor="gt-to-rol">
              Rol
            </label>
            <select
              id="gt-to-rol"
              className="form-select form-select-sm"
              value={filtros.rol}
              onChange={filtro("rol")}
            >
              <option value="">Todos los roles</option>
              {Object.entries(ROL).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="mz-campo">
            <label className="form-label" htmlFor="gt-to-tipo">
              Tipo
            </label>
            <select
              id="gt-to-tipo"
              className="form-select form-select-sm"
              value={filtros.tipo}
              onChange={filtro("tipo")}
            >
              <option value="">Todos</option>
              {Object.entries(TIPO).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {!regulariza && (
        <p className="mz-small mz-faint mb-0">
          Se listan las tareas de su equipo que esperan validación. La
          regularización en bloque de toda la empresa requiere el permiso de
          regularizar.
        </p>
      )}

      {datos?.sinEquipo ? (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="info-circle" />
          <span>
            Para ver aquí las tareas de su equipo necesita el permiso de ver
            Equipo. También puede validar una tarea desde su panel de
            actividades.
          </span>
        </div>
      ) : (
        <EstadoDeCarga
          cargando={datos === null && !error}
          error={error}
          onReintentar={cargar}
          vacio={datos !== null && tareas.length === 0}
          hayFiltros={hayFiltros}
          onLimpiarFiltros={() =>
            setFiltros({ usuario: "", rol: "", tipo: "" })
          }
          textoVacio="No hay tareas pendientes de validar."
        />
      )}

      {regulariza && elegidas.length > 0 && (
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
            onClick={() => setEnBloque({ tipo: "fecha" })}
          >
            Aprobar fecha fin en bloque
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setEnBloque({ tipo: "objetivo" })}
          >
            Regularizar tiempo objetivo
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

      {tareas.length > 0 && (
        <div className="mz-table-wrap gt-tabla-wrap">
          <table className="mz-table gt-tabla">
            <caption className="visually-hidden">Tareas por validar</caption>
            <thead>
              <tr>
                <th scope="col" className="gt-fija">
                  <span className="gt-fija__contenido">
                    {regulariza && (
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={todas}
                        disabled={!elegibles.length}
                        onChange={() =>
                          setSeleccion(
                            todas
                              ? new Set()
                              : new Set(elegibles.map((t) => t.id)),
                          )
                        }
                        aria-label="Seleccionar todas las tareas que puede validar"
                      />
                    )}
                    Tarea
                  </span>
                </th>
                <th scope="col">Responsable</th>
                <th scope="col">Tipo</th>
                <th scope="col">Tiempo objetivo</th>
                <th scope="col">Fecha fin</th>
                <th scope="col" className="num">
                  H. reales
                </th>
                <th scope="col">
                  <span className="visually-hidden">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tareas.map((t) => {
                const propia = t.assigned_to?.id === usuarioId;
                return (
                  <tr key={t.id}>
                    <th scope="row" className="gt-fija">
                      <span className="gt-fija__contenido">
                        {regulariza && (
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={seleccion.has(t.id)}
                            disabled={propia}
                            onChange={() => alternar(t.id)}
                            aria-label={
                              propia
                                ? `«${t.title}» es suya: no puede validarla`
                                : `Seleccionar «${t.title}»`
                            }
                          />
                        )}
                        <span className="gt-fija__texto">
                          <span className="gt-fija__titulo">{t.title}</span>
                          {propia && (
                            <span className="mz-small mz-faint">
                              Propia: no puede validarla
                            </span>
                          )}
                        </span>
                      </span>
                    </th>
                    <td>
                      {nombreDe(t.assigned_to)}
                      {rolDe(t.assigned_to) && (
                        <span className="mz-small mz-faint d-block">
                          {rolLegible(rolDe(t.assigned_to))}
                        </span>
                      )}
                    </td>
                    <td>{TIPO[t.type] ?? t.type}</td>
                    <td>
                      {horas(objetivoOficial(t))}
                      <span className="d-block">
                        <PillValidado
                          validado={
                            t.target_time_validated !== null &&
                            t.target_time_validated !== undefined
                          }
                        />
                      </span>
                    </td>
                    <td>
                      {fechaCorta(t.end_date)}
                      <span className="d-block">
                        <EstadoFechaFin estado={t.end_date_approval_status} />
                      </span>
                    </td>
                    <td className="num">{horas(t.real_hours)}</td>
                    <td>
                      <MenuDeAcciones
                        etiqueta={`Más acciones de «${t.title}»`}
                        acciones={[
                          !propia && {
                            texto: "Validar",
                            onClick: () => setValidando(t),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {validando && (
        <ValidarTarea
          tarea={validando}
          onCerrar={() => {
            setValidando(null);
            cargar();
          }}
        />
      )}
      {enBloque?.tipo === "objetivo" && (
        <RegularizarEnBloque
          ids={elegidas.map((t) => t.id)}
          onCerrar={() => setEnBloque(null)}
          onHecho={(texto) => {
            setEnBloque(null);
            setAviso({ texto });
            cargar();
          }}
        />
      )}
      {enBloque?.tipo === "fecha" && (
        <AprobarFechasEnBloque
          tareas={elegidas}
          onCerrar={() => setEnBloque(null)}
          onHecho={(texto) => {
            setEnBloque(null);
            setAviso({ texto });
            cargar();
          }}
        />
      )}
    </div>
  );
}
