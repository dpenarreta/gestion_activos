/*
 * Las actividades de un proyecto (`ProjectActivitiesTab` de Nexo): una línea
 * de tiempo por día, el tiempo acumulado frente al objetivo y, para quien
 * participa, el registro con hora de inicio y fin (sin duración manual), la
 * fase y la fecha (hoy o, retroactivo, uno de los días que admite el
 * servidor). La descripción pide al menos 15 caracteres, como el servidor.
 * A diferencia de Tareas, no se valida el cruce de horarios.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  errorDeProyectos,
  proyectosGhService,
} from "../../../api/proyectosGhService";
import { tareasService } from "../../../api/tareasService";
import {
  Campo,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { useVisorDeAdjuntos } from "../../Soporte/VisorAdjunto";
import { ErrorEnLinea } from "../comunes";
import {
  diaDeLaSemana,
  duracion,
  fechaCorta,
  fechasRetroactivas,
  horas,
  hoy,
} from "../Tareas/tareasComunes";
import {
  CATEGORIA_DOCUMENTO,
  MINIMO_DESCRIPCION,
  diaDeActividad,
  duracionEntre,
  fasesVisibles,
  nombreDe,
} from "./proyectosComunes";

/** La ventana por defecto del servidor mientras llegan los ajustes. */
const VENTANA_POR_DEFECTO = 2;

const VACIO = {
  phase: "",
  description: "",
  start_time: "",
  end_time: "",
  comments: "",
};

function diaLargo(dia) {
  const [y, m, d] = dia.split("-").map(Number);
  const texto = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-EC", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function Actividades({ proyecto, usuarioId, onRegistrada }) {
  const [actividades, setActividades] = useState(null);
  const [error, setError] = useState(null);
  const { abrir, abriendo, visor, error: errorVisor } = useVisorDeAdjuntos();

  const cargar = useCallback(() => {
    setError(null);
    proyectosGhService
      .actividades(proyecto.id)
      .then((lista) => setActividades(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setError(
          errorDeProyectos(err, "No se pudieron cargar las actividades.")
            .mensaje,
        ),
      );
  }, [proyecto.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const minutos = (actividades ?? []).reduce(
    (s, a) => s + (a.duration ?? 0),
    0,
  );
  const objetivo = proyecto.target_time_hours ?? 0;
  const restantes = Math.max(0, objetivo - minutos / 60);
  const ejecutado =
    objetivo > 0
      ? Math.min(100, Math.round((minutos / 60 / objetivo) * 100))
      : 0;

  const porDia = useMemo(() => {
    const grupos = new Map();
    for (const a of actividades ?? []) {
      const clave = diaDeActividad(a);
      grupos.set(clave, [...(grupos.get(clave) ?? []), a]);
    }
    return [...grupos.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [actividades]);

  return (
    <div className="mz-grid-2 gp-actividades">
      <div className="mz-stack">
        <h3 className="gp-subtitulo">Línea de tiempo</h3>
        <ErrorEnLinea mensaje={errorVisor} />
        <EstadoDeCarga
          cargando={actividades === null && !error}
          error={error}
          onReintentar={cargar}
          vacio={actividades?.length === 0}
          textoVacio={
            proyecto.can_participate
              ? "Todavía no hay actividades registradas. Registre la primera con el formulario."
              : "Todavía no hay actividades registradas."
          }
        />
        {porDia.map(([dia, lista]) => (
          <section key={dia} aria-labelledby={`gp-dia-${dia}`}>
            <h4 id={`gp-dia-${dia}`} className="gp-dia">
              {diaLargo(dia)}
            </h4>
            <ul className="gp-lista">
              {lista.map((a) => {
                const fase = proyecto.phases?.find((f) => f.id === a.phase_id);
                return (
                  <li key={a.id} className="gp-actividad">
                    <div className="gt-min0 flex-grow-1">
                      <p className="mb-1">{a.description}</p>
                      <p className="mz-small mz-faint mb-0">
                        {[
                          nombreDe(a.author),
                          a.start_time && a.end_time
                            ? `${a.start_time}–${a.end_time}`
                            : null,
                          fase?.name,
                          a.is_retroactive ? "retroactivo" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {a.comments && (
                        <p className="mz-small mb-0 mt-1 gh-pre">
                          {a.comments}
                        </p>
                      )}
                      {a.documents?.length > 0 && (
                        <p className="gp-marcas mt-2 mb-0">
                          {a.documents.map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              className="btn btn-outline-secondary btn-sm"
                              disabled={abriendo === d.id}
                              onClick={() =>
                                abrir({
                                  id: d.id,
                                  url: `/projects/${proyecto.id}/documents/${d.id}/file/`,
                                  nombre: d.file_name,
                                })
                              }
                            >
                              <Icon name="paperclip" /> {d.file_name}
                              <span className="visually-hidden">
                                {" "}
                                ({CATEGORIA_DOCUMENTO[d.category] ?? d.category}
                                )
                              </span>
                            </button>
                          ))}
                        </p>
                      )}
                    </div>
                    <span className="gp-actividad__tiempo">
                      {duracion(a.duration)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* En el teléfono, el registro va arriba (ver Proyectos.css). */}
      <div className="mz-stack gp-actividades__lateral">
        <section className="mz-card">
          <div className="mz-card-head">
            <h3>Tiempo acumulado</h3>
          </div>
          <div className="mz-card-body">
            <dl className="gh-tarjeta-kv gh-tarjeta-kv--estrecha mb-2">
              <dt>Horas registradas</dt>
              <dd>{duracion(minutos)}</dd>
              <dt>Tiempo objetivo</dt>
              <dd>{horas(objetivo)}</dd>
              <dt>Horas restantes</dt>
              <dd>{horas(restantes)}</dd>
            </dl>
            <span className="gh-avance d-block" aria-hidden="true">
              <span style={{ width: `${ejecutado}%` }} />
            </span>
            <p className="mz-small mz-faint mt-1 mb-0">
              {ejecutado} % ejecutado
            </p>
          </div>
        </section>
        {proyecto.can_participate && (
          <Registro
            proyecto={proyecto}
            actividades={actividades}
            usuarioId={usuarioId}
            onRegistrada={(nueva) => {
              setActividades((lista) => [...(lista ?? []), nueva]);
              onRegistrada?.();
            }}
          />
        )}
      </div>
      {visor}
    </div>
  );
}

function Registro({ proyecto, actividades, usuarioId, onRegistrada }) {
  const hoyDia = useMemo(() => hoy(), []);
  const [ventana, setVentana] = useState(VENTANA_POR_DEFECTO);
  const [fecha, setFecha] = useState(hoyDia);
  const [valores, setValores] = useState(VACIO);
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  const formulario = useRef(null);

  // La ventana retroactiva es un ajuste de Tareas. Si no se puede leer (sin
  // acceso a Tareas), se usa la de por defecto: el servidor valida igual.
  useEffect(() => {
    let vigente = true;
    tareasService
      .ajustes()
      .then((a) => {
        if (vigente && a?.retroactive_window_business_days)
          setVentana(a.retroactive_window_business_days);
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, []);

  const dias = useMemo(
    () => [hoyDia, ...fechasRetroactivas(hoyDia, ventana)],
    [hoyDia, ventana],
  );
  const fases = fasesVisibles(proyecto.phases, actividades, usuarioId);
  const minutos = duracionEntre(valores.start_time, valores.end_time);
  const faltan = MINIMO_DESCRIPCION - valores.description.trim().length;

  const cambiar = (campo) => (e) =>
    setValores((v) => ({ ...v, [campo]: e.target.value }));

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const e = {};
    if (faltan > 0)
      e.description = `La descripción debe tener al menos ${MINIMO_DESCRIPCION} caracteres (faltan ${faltan}).`;
    if (!valores.start_time) e.start_time = "Indique la hora de inicio.";
    if (!valores.end_time) e.end_time = "Indique la hora de fin.";
    else if (valores.start_time && !minutos)
      e.end_time = "La hora de fin debe ser posterior a la de inicio.";
    setErrores(e);
    setError(null);
    setMensaje(null);
    if (Object.keys(e).length) {
      enfocarPrimerError(formulario.current);
      return;
    }
    enCurso.current = true;
    setGuardando(true);
    try {
      const nueva = await proyectosGhService.registrarActividad(proyecto.id, {
        description: valores.description.trim(),
        comments: valores.comments.trim(),
        start_time: valores.start_time,
        end_time: valores.end_time,
        phase: valores.phase ? Number(valores.phase) : null,
        activity_date: fecha,
      });
      onRegistrada(nueva);
      setValores(VACIO);
      setErrores({});
      setMensaje(`Actividad registrada: ${duracion(nueva.duration)}.`);
    } catch (err) {
      const fallo = errorDeProyectos(err, "No se pudo registrar la actividad.");
      setErrores(fallo.campos);
      setError(fallo.mensaje);
      enfocarPrimerError(formulario.current);
    } finally {
      enCurso.current = false;
      setGuardando(false);
    }
  }

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Registrar actividad</h3>
      </div>
      <form ref={formulario} className="mz-card-body" onSubmit={enviar}>
        <p role="status" className="visually-hidden">
          {mensaje}
        </p>
        {mensaje && (
          <div className="mz-alert mz-alert--ok mb-2" aria-hidden="true">
            <Icon name="check2-circle" />
            <span>{mensaje}</span>
          </div>
        )}
        <ErrorEnLinea mensaje={error} className="mb-2" />
        <Campo id="gp-act-fecha" etiqueta="Fecha" error={errores.activity_date}>
          <select
            className="form-select"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          >
            {dias.map((d) => (
              <option key={d} value={d}>
                {d === hoyDia
                  ? `Hoy, ${diaDeLaSemana(d).toLowerCase()}`
                  : diaDeLaSemana(d)}{" "}
                {fechaCorta(d)}
              </option>
            ))}
          </select>
        </Campo>
        {fases.length > 0 && (
          <Campo
            id="gp-act-fase"
            etiqueta="Fase"
            error={errores.phase}
            className="mt-2"
          >
            <select
              className="form-select"
              value={valores.phase}
              onChange={cambiar("phase")}
            >
              <option value="">Sin fase específica</option>
              {fases.map((f) => (
                <option key={f.id} value={String(f.id)}>
                  {f.name}
                </option>
              ))}
            </select>
          </Campo>
        )}
        <Campo
          id="gp-act-descripcion"
          etiqueta="Descripción"
          obligatorio
          error={errores.description}
          ayuda={
            valores.description.trim() && faltan > 0
              ? `Qué hizo, en al menos ${MINIMO_DESCRIPCION} caracteres. Faltan ${faltan}.`
              : `Qué hizo, en al menos ${MINIMO_DESCRIPCION} caracteres.`
          }
          className="mt-2"
        >
          <textarea
            className="form-control"
            rows={2}
            maxLength={5000}
            value={valores.description}
            onChange={cambiar("description")}
          />
        </Campo>
        <div className="gt-form-grid mt-2">
          <Campo
            id="gp-act-inicio"
            etiqueta="Hora de inicio"
            obligatorio
            error={errores.start_time}
          >
            <input
              type="time"
              className="form-control"
              value={valores.start_time}
              onChange={cambiar("start_time")}
            />
          </Campo>
          <Campo
            id="gp-act-fin"
            etiqueta="Hora de fin"
            obligatorio
            error={errores.end_time}
          >
            <input
              type="time"
              className="form-control"
              value={valores.end_time}
              onChange={cambiar("end_time")}
            />
          </Campo>
        </div>
        <p className="gh-recuadro mz-small mt-2 mb-0" aria-live="polite">
          Duración calculada:{" "}
          <strong>{minutos ? duracion(minutos) : "—"}</strong>
        </p>
        <Campo
          id="gp-act-comentarios"
          etiqueta="Comentarios"
          error={errores.comments}
          className="mt-2"
        >
          <textarea
            className="form-control"
            rows={2}
            maxLength={5000}
            value={valores.comments}
            onChange={cambiar("comments")}
          />
        </Campo>
        <div className="mz-actions justify-content-end mt-3">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={guardando}
          >
            {guardando ? "Registrando…" : "Registrar actividad"}
          </button>
        </div>
      </form>
    </section>
  );
}
