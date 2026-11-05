/*
 * Equipo (`TeamModule` de Nexo): las personas de su equipo según el
 * organigrama, con sus tareas por estado y su última actividad en el
 * sistema; al elegir una, sus tareas activas por estado. Desde aquí se le
 * asigna una tarea, se leen sus actividades (sin registrar por ella) y sus
 * comentarios, y —con `tareas.validar`— se valida su tarea.
 *
 * El correo llega enmascarado del servidor en la lista. El servidor decide
 * quién es de su equipo y responde 403 por quien no lo es.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { errorDeTareas, tareasService } from "../../../api/tareasService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  EQUIPO_VER,
  TAREAS_VALIDAR,
} from "../../../modulos/permisosGestionHumana";
import { Aviso, MenuDeAcciones, fechaHora } from "../comunes";
import { ConAccesoTareas, Encabezado, useTareas } from "./ContextoTareas";
import { FormularioTarea } from "./FormularioTarea";
import { MarcaVencida, PillEstado, PillPrioridad } from "./Indicadores";
import { PanelActividades } from "./PanelActividades";
import { PanelComentarios } from "./PanelComentarios";
import { ValidarTarea } from "./ValidarTarea";
import {
  ESTADO,
  ESTADOS,
  FRECUENCIA,
  ICONO_ESTADO,
  fechaCorta,
  haceCuanto,
  horas,
  iniciales,
  objetivoOficial,
  objetivoValidado,
  ordenar,
  rolLegible,
  vencida,
} from "./tareasComunes";

export function Equipo() {
  return (
    <ConAccesoTareas titulo="Equipo" permiso={EQUIPO_VER}>
      <PantallaEquipo />
    </ConAccesoTareas>
  );
}

/** Más de un día sin entrar (o nunca) es lo que merece destacarse. */
function inactividad(iso) {
  if (!iso) return { texto: "Nunca ingresó", alerta: true };
  const horasSin = (Date.now() - new Date(iso).getTime()) / 3600000;
  return { texto: haceCuanto(iso), alerta: horasSin >= 24 };
}

function TarjetaPersona({ persona, onAbrir }) {
  const t = persona.tasks ?? {};
  const pct = t.total ? Math.round((t.completed / t.total) * 100) : 0;
  const inact = inactividad(persona.last_activity_at);
  return (
    <li>
      <button
        type="button"
        id={`gt-persona-${persona.id}`}
        className="gt-persona"
        onClick={() => onAbrir(persona)}
      >
        <span className="gt-persona__cabeza">
          <span className="gt-avatar gt-avatar--grande" aria-hidden="true">
            {iniciales(persona.name)}
          </span>
          <span className="gt-min0">
            <strong className="gt-persona__nombre">{persona.name}</strong>
            <span className="mz-small mz-faint d-block">
              {rolLegible(persona.role) || "Sin rol de Gestión Humana"}
            </span>
            <span className="mz-small mz-faint d-block gt-corta">
              {persona.email}
            </span>
          </span>
        </span>
        <span
          className={`mz-small d-block ${inact.alerta ? "gt-texto--warn" : ""}`}
        >
          <Icon name={inact.alerta ? "exclamation-triangle" : "circle-fill"} />{" "}
          Última actividad: {inact.texto}
        </span>
        <span className="gt-persona__cuentas">
          <span>
            <strong>{t.pending ?? 0}</strong> pendientes
          </span>
          <span>
            <strong>{t.in_progress ?? 0}</strong> en progreso
          </span>
          <span>
            <strong>{t.completed ?? 0}</strong> completadas
          </span>
        </span>
        {t.total > 0 ? (
          <span className="d-block">
            <span className="mz-small mz-faint">
              {t.total} tareas · {pct} % completado
            </span>
            <span className="gh-avance d-block mt-1" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
          </span>
        ) : (
          <span className="mz-small mz-faint d-block">
            Sin tareas asignadas.
          </span>
        )}
      </button>
    </li>
  );
}

function TareasDeLaPersona({ tareas, manejadores, puedeValidar }) {
  const [orden, setOrden] = useState({ clave: null, sentido: "asc" });
  const ordenadas = useMemo(
    () => ordenar(tareas, orden.clave, orden.sentido),
    [tareas, orden],
  );
  const [contraidas, setContraidas] = useState({ COMPLETADA: true });

  const encabezado = (clave, texto, num = false) => (
    <th
      scope="col"
      className={num ? "num" : undefined}
      aria-sort={
        orden.clave === clave
          ? orden.sentido === "asc"
            ? "ascending"
            : "descending"
          : undefined
      }
    >
      <button
        type="button"
        className="gt-orden"
        onClick={() =>
          setOrden((o) =>
            o.clave === clave
              ? { clave, sentido: o.sentido === "asc" ? "desc" : "asc" }
              : { clave, sentido: "asc" },
          )
        }
      >
        {texto}
        {orden.clave === clave && (
          <Icon name={orden.sentido === "asc" ? "arrow-up" : "arrow-down"} />
        )}
      </button>
    </th>
  );

  return ESTADOS.map((estado) => {
    const lista = ordenadas.filter((t) => t.status === estado);
    const id = `gt-eq-${estado}`;
    const contraida = Boolean(contraidas[estado]);
    return (
      <section key={estado} className="gt-seccion" aria-labelledby={`${id}-t`}>
        <h3 className="gt-seccion__titulo">
          <button
            type="button"
            className="gt-columna__plegar"
            aria-expanded={!contraida}
            aria-controls={id}
            onClick={() =>
              setContraidas((c) => ({ ...c, [estado]: !c[estado] }))
            }
          >
            <Icon name={contraida ? "chevron-right" : "chevron-down"} />
            <Icon name={ICONO_ESTADO[estado]} />
            <span id={`${id}-t`}>{ESTADO[estado]}</span>
            <span className="gt-cuenta">
              {lista.length}
              <span className="visually-hidden"> tareas</span>
            </span>
          </button>
        </h3>
        <div id={id} hidden={contraida}>
          {lista.length === 0 ? (
            <p className="mz-empty mb-0">Sin tareas en esta sección.</p>
          ) : (
            <div className="mz-table-wrap gt-tabla-wrap">
              <table className="mz-table gt-tabla">
                <caption className="visually-hidden">
                  Tareas en estado {ESTADO[estado]}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="gt-fija">
                      Tarea
                    </th>
                    <th scope="col">Frecuencia</th>
                    <th scope="col">Estado</th>
                    {encabezado("priority", "Prioridad")}
                    {encabezado("start_date", "Inicio")}
                    {encabezado("end_date", "Fin")}
                    {encabezado("objetivo", "T. objetivo", true)}
                    {encabezado("real_hours", "H. reales", true)}
                    {encabezado("comment_count", "Coment.", true)}
                    <th scope="col">
                      <span className="visually-hidden">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((t) => (
                    <tr key={t.id}>
                      <th scope="row" className="gt-fija">
                        <span className="gt-fija__texto">
                          <span className="gt-fija__titulo">{t.title}</span>
                          {t.description && (
                            <span className="mz-small mz-faint gt-corta">
                              {t.description}
                            </span>
                          )}
                        </span>
                      </th>
                      <td>{FRECUENCIA[t.frequency] ?? t.frequency}</td>
                      <td>
                        <PillEstado estado={t.status} />
                      </td>
                      <td>
                        <PillPrioridad prioridad={t.priority} />
                      </td>
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
                      <td className="num">{t.comment_count ?? 0}</td>
                      <td>
                        <MenuDeAcciones
                          etiqueta={`Más acciones de «${t.title}»`}
                          acciones={[
                            {
                              texto: "Ver actividades",
                              onClick: () => manejadores.actividades(t),
                            },
                            {
                              texto: `Comentarios (${t.comment_count ?? 0})`,
                              onClick: () => manejadores.comentarios(t),
                            },
                            puedeValidar && {
                              texto: "Validar tarea",
                              onClick: () => manejadores.validar(t),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    );
  });
}

function PantallaEquipo() {
  const { usuarioId, can } = useTareas();
  const [personas, setPersonas] = useState(null);
  const [error, setError] = useState(null);
  // La persona abierta va en la dirección (`?persona=`): «Atrás» del
  // navegador vuelve a la lista.
  const [parametros, setParametros] = useSearchParams();
  const personaId = Number(parametros.get("persona")) || null;
  const elegida = personas?.find((p) => p.id === personaId) ?? null;
  const ultima = useRef(null);
  const [tareas, setTareas] = useState(null);
  const [errorTareas, setErrorTareas] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [asignando, setAsignando] = useState(null);
  const [comentando, setComentando] = useState(null);
  const [viendo, setViendo] = useState(null);
  const [validando, setValidando] = useState(null);
  const volver = useRef(null);
  const puedeValidar = can(TAREAS_VALIDAR);

  const cargar = useCallback(() => {
    setError(null);
    tareasService
      .equipo()
      .then((lista) => setPersonas(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setError(errorDeTareas(err, "No se pudo cargar su equipo.").mensaje),
      );
  }, []);

  const cargarTareas = useCallback((persona) => {
    setErrorTareas(null);
    setTareas(null);
    tareasService
      .tareasDe(persona.id)
      .then((lista) => setTareas(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setErrorTareas(
          errorDeTareas(err, "No se pudieron cargar sus tareas.").mensaje,
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (elegida) {
      ultima.current = elegida.id;
      cargarTareas(elegida);
      volver.current?.focus();
      return undefined;
    }
    // De vuelta en la lista, el foco regresa a la tarjeta que se abrió.
    if (!ultima.current || !personas) return undefined;
    const reloj = setTimeout(
      () => document.getElementById(`gt-persona-${ultima.current}`)?.focus(),
      0,
    );
    return () => clearTimeout(reloj);
    // `personas` se refresca al volver; solo importa quién está abierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elegida?.id, personas === null]);

  function abrir(persona) {
    setTareas(null);
    setParametros({ persona: String(persona.id) });
  }

  function regresar() {
    setTareas(null);
    setParametros({});
    cargar();
  }

  const manejadores = {
    actividades: setViendo,
    comentarios: setComentando,
    validar: setValidando,
  };

  return (
    <div className="gh-page">
      {!elegida ? (
        <>
          <Encabezado
            titulo="Equipo"
            descripcion="Las personas de su equipo según el organigrama y el avance de sus tareas."
          >
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setAsignando({})}
            >
              <Icon name="plus-lg" /> Asignar tarea
            </button>
          </Encabezado>
          <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
          <EstadoDeCarga
            cargando={personas === null && !error}
            error={error}
            onReintentar={cargar}
            vacio={personas?.length === 0}
            textoVacio="No tiene personas a cargo en el organigrama. Si cree que es un error, pida a Gestión Humana que revise su cargo."
          />
          {personas?.length > 0 && (
            <>
              <p className="mz-small mz-faint mb-0">
                {personas.length}{" "}
                {personas.length === 1 ? "integrante" : "integrantes"}
              </p>
              <ul className="gt-personas">
                {personas.map((p) => (
                  <TarjetaPersona key={p.id} persona={p} onAbrir={abrir} />
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <>
          <div>
            <button
              ref={volver}
              type="button"
              className="btn btn-link px-0"
              onClick={regresar}
            >
              <Icon name="arrow-left" /> Volver a Equipo
            </button>
          </div>
          <Encabezado
            titulo={elegida.name}
            descripcion={`${rolLegible(elegida.role) || "Sin rol de Gestión Humana"} · ${elegida.email}`}
          >
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setAsignando({ persona: elegida.id })}
            >
              <Icon name="plus-lg" /> Asignar tarea
            </button>
          </Encabezado>
          <div className="gt-persona__cuentas">
            <span>
              <strong>{elegida.tasks?.pending ?? 0}</strong> pendientes
            </span>
            <span>
              <strong>{elegida.tasks?.in_progress ?? 0}</strong> en progreso
            </span>
            <span>
              <strong>{elegida.tasks?.completed ?? 0}</strong> completadas
            </span>
            {elegida.last_activity_at && (
              <span className="mz-faint">
                Última actividad: {fechaHora(elegida.last_activity_at)}
              </span>
            )}
          </div>
          <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
          <EstadoDeCarga
            cargando={tareas === null && !errorTareas}
            error={errorTareas}
            onReintentar={() => cargarTareas(elegida)}
            vacio={tareas?.length === 0}
            textoVacio="No tiene tareas activas asignadas."
            accionVacio={
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setAsignando({ persona: elegida.id })}
              >
                Asignarle una tarea
              </button>
            }
          />
          {tareas?.length > 0 && (
            <TareasDeLaPersona
              tareas={tareas}
              manejadores={manejadores}
              puedeValidar={puedeValidar}
            />
          )}
        </>
      )}

      {asignando && (
        <FormularioTarea
          asignadoInicial={asignando.persona}
          usuarioId={usuarioId}
          onCerrar={() => setAsignando(null)}
          onGuardada={(tarea) => {
            setAsignando(null);
            setAviso({ texto: `Tarea «${tarea.title}» asignada.` });
            if (elegida) cargarTareas(elegida);
            else cargar();
          }}
        />
      )}
      {comentando && (
        <PanelComentarios
          tarea={comentando}
          onCerrar={() => setComentando(null)}
          onComentado={(id) =>
            setTareas((l) =>
              l?.map((t) =>
                t.id === id
                  ? { ...t, comment_count: (t.comment_count ?? 0) + 1 }
                  : t,
              ),
            )
          }
        />
      )}
      {viendo && (
        <PanelActividades
          tarea={viendo}
          soloLectura
          onCerrar={() => setViendo(null)}
          onCambio={() => elegida && cargarTareas(elegida)}
        />
      )}
      {validando && (
        <ValidarTarea
          tarea={validando}
          onCerrar={() => setValidando(null)}
          onCambio={() => elegida && cargarTareas(elegida)}
        />
      )}
    </div>
  );
}
