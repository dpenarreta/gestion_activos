/*
 * Registro de actividades de una tarea (`ActivityPanel` y `ActivityItem` de
 * Nexo): el total acumulado, el Tiempo Objetivo y la Fecha Fin con su
 * historial, la validación del líder, la lista de registros con sus
 * comentarios y el formulario para registrar horas.
 *
 * Reglas (las aplica el servidor; aquí se anticipan): una tarea Fija admite
 * 2 registros; solo quien registró borra; solo quien administra Tareas edita
 * horas ya registradas, con comentario obligatorio; nadie valida su propia
 * tarea. Con `soloLectura` (desde Equipo) no se registra.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { errorDeTareas, tareasService } from "../../../api/tareasService";
import {
  Campo,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { confirmar } from "../../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { TAREAS_ADMINISTRAR } from "../../../modulos/permisosGestionHumana";
import { ErrorEnLinea, MenuDeAcciones, fechaHora } from "../comunes";
import {
  CamposDeHoras,
  REGISTRO_VACIO,
  SinMotivos,
  cruceCon,
  cuerpoDelRegistro,
  useAgendaDelDia,
  useFormatoDeActividad,
  validarRegistro,
} from "./CamposDeHoras";
import { useMotivos, useTareas } from "./ContextoTareas";
import {
  Desviacion,
  EstadoFechaFin,
  Historial,
  PillValidado,
} from "./Indicadores";
import { ValidarTarea } from "./ValidarTarea";
import { PanelLateral } from "./Ventanas";
import {
  MAXIMO_REGISTROS_FIJA,
  duracion,
  fechaCorta,
  horas,
  hoy,
  motivosElegibles,
  nombreDe,
  nombreDelMotivo,
} from "./tareasComunes";

function EditarHoras({ actividad, tareaId, onCerrar, onHecho }) {
  const [horasTxt, setHoras] = useState(
    String(Math.floor(actividad.duration / 60)),
  );
  const [minutos, setMinutos] = useState(String(actividad.duration % 60));
  const [comentario, setComentario] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  const panel = useRef(null);

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const h = Number(horasTxt) || 0;
    const m = Number(minutos) || 0;
    const e = {};
    if (h * 60 + m <= 0) e.hours = "La duración debe ser mayor a 0.";
    if (h > 23) e.hours = "Hasta 23 horas.";
    if (m > 59) e.minutes = "Hasta 59 minutos.";
    if (!comentario.trim())
      e.comment = "Indique por qué se modifican las horas.";
    setErrores(e);
    if (Object.keys(e).length) {
      enfocarPrimerError(panel.current);
      return;
    }
    enCurso.current = true;
    setGuardando(true);
    setError(null);
    try {
      const actualizada = await tareasService.editarActividad(
        tareaId,
        actividad.id,
        { hours: h, minutes: m, comment: comentario.trim() },
      );
      onHecho(actualizada);
    } catch (err) {
      const fallo = errorDeTareas(err, "No se pudieron modificar las horas.");
      setErrores(fallo.campos);
      setError(fallo.mensaje);
      setGuardando(false);
      enCurso.current = false;
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo="Editar horas de la actividad"
      subtitulo={`Horas actuales: ${duracion(actividad.duration)}. El cambio queda en la bitácora y se avisa a la persona responsable.`}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar="Guardar cambios"
      isSaving={guardando}
    >
      <div ref={panel}>
        <div className="gt-form-grid">
          <Campo
            id="gt-editar-horas"
            etiqueta="Nuevas horas"
            error={errores.hours}
          >
            <input
              type="number"
              min={0}
              max={23}
              className="form-control"
              value={horasTxt}
              onChange={(e) => setHoras(e.target.value)}
            />
          </Campo>
          <Campo
            id="gt-editar-minutos"
            etiqueta="Nuevos minutos"
            error={errores.minutes}
          >
            <input
              type="number"
              min={0}
              max={59}
              className="form-control"
              value={minutos}
              onChange={(e) => setMinutos(e.target.value)}
            />
          </Campo>
        </div>
        <Campo
          id="gt-editar-comentario"
          etiqueta="Comentario de la modificación"
          obligatorio
          error={errores.comment}
          className="mt-3"
        >
          <textarea
            className="form-control"
            rows={3}
            maxLength={5000}
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
          />
        </Campo>
        <ErrorEnLinea mensaje={error} className="mt-3" />
      </div>
    </ModalDialog>
  );
}

function ComentariosDeActividad({ tareaId, actividad, onContado }) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState("");
  const [errorEnvio, setErrorEnvio] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);
  const id = `gt-act-${actividad.id}-comentario`;

  const cargar = useCallback(() => {
    setError(null);
    setLista(null);
    tareasService
      .comentariosDeActividad(tareaId, actividad.id)
      .then((datos) => setLista(Array.isArray(datos) ? datos : []))
      .catch((err) =>
        setError(
          errorDeTareas(err, "No se pudieron cargar los comentarios.").mensaje,
        ),
      );
  }, [tareaId, actividad.id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function enviar(evento) {
    evento.preventDefault();
    if (!texto.trim() || enCurso.current) return;
    enCurso.current = true;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const nuevo = await tareasService.comentarActividad(
        tareaId,
        actividad.id,
        texto.trim(),
      );
      setLista((l) => [...(l ?? []), nuevo]);
      setTexto("");
      onContado();
    } catch (err) {
      setErrorEnvio(
        errorDeTareas(err, "No se pudo publicar el comentario.").mensaje,
      );
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  return (
    <div className="gt-act__comentarios">
      <EstadoDeCarga
        cargando={lista === null && !error}
        error={error}
        onReintentar={cargar}
      />
      {lista?.length > 0 && (
        <ul className="gt-act__lista-comentarios">
          {lista.map((c) => (
            <li key={c.id}>
              <span className="mz-small">
                <strong>{nombreDe(c.author)}</strong> ·{" "}
                <span className="mz-faint">{fechaHora(c.created_at)}</span>
              </span>
              <p className="gt-hilo__texto mb-0">{c.text}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={enviar} className="gt-act__comentar">
        <label className="visually-hidden" htmlFor={id}>
          Comentario sobre esta actividad
        </label>
        <input
          id={id}
          className="form-control form-control-sm"
          placeholder="Escriba un comentario…"
          maxLength={5000}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <button
          type="submit"
          className="btn btn-outline-secondary btn-sm"
          disabled={!texto.trim() || enviando}
        >
          Enviar
        </button>
      </form>
      <ErrorEnLinea mensaje={errorEnvio} className="mt-2" />
    </div>
  );
}

function ActividadItem({
  actividad: a,
  tareaId,
  motivos,
  usuarioId,
  administra,
  onEliminada,
  onActualizada,
}) {
  const [comentariosAbiertos, setComentariosAbiertos] = useState(false);
  const [cuenta, setCuenta] = useState(a.comment_count ?? 0);
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState(null);
  const motivo = (motivos ?? []).find((m) => m.key === a.reason);
  const etiqueta = nombreDelMotivo(motivos, a.reason);
  const esAutor = a.author?.id === usuarioId;

  async function eliminar() {
    const seguir = await confirmar({
      titulo: `¿Eliminar la actividad «${etiqueta}» de ${duracion(a.duration)}?`,
      mensaje:
        "Esas horas dejan de contar en la tarea y en su carga del mes. La acción no se puede deshacer.",
      accion: "Eliminar actividad",
    });
    if (!seguir) return;
    setError(null);
    try {
      await tareasService.eliminarActividad(tareaId, a.id);
      onEliminada(a.id);
    } catch (err) {
      setError(errorDeTareas(err, "No se pudo eliminar la actividad.").mensaje);
    }
  }

  return (
    <li className="gt-act">
      <div className="gt-act__cabeza">
        <span className="mz-pill mz-pill--neutral">{etiqueta}</span>
        {motivo?.is_archived && (
          <span className="mz-small mz-faint">(motivo archivado)</span>
        )}
        {motivo && !motivo.is_archived && !motivo.is_active && (
          <span className="mz-small mz-faint">(motivo inactivo)</span>
        )}
        <MenuDeAcciones
          etiqueta={`Más acciones de la actividad «${etiqueta}» del ${fechaHora(a.created_at)}`}
          acciones={[
            administra && {
              texto: "Editar horas",
              onClick: () => setEditando(true),
            },
            esAutor && {
              texto: "Eliminar actividad",
              onClick: eliminar,
              peligro: true,
            },
          ]}
        />
      </div>
      {(a.is_retroactive || a.modified_by_admin) && (
        <div className="gt-act__marcas">
          {a.is_retroactive && (
            <span className="mz-pill mz-pill--warn">
              <Icon name="clock-history" /> Retroactivo
              {a.activity_date ? ` · ${fechaCorta(a.activity_date)}` : ""}
            </span>
          )}
          {a.modified_by_admin && (
            <span className="mz-pill mz-pill--info">
              <Icon name="pencil" /> Modificado por administración
            </span>
          )}
        </div>
      )}
      {a.modified_by_admin && a.admin_comment && (
        <p className="mz-small mb-1">
          <span className="mz-faint">Motivo de la modificación:</span>{" "}
          {a.admin_comment}
        </p>
      )}
      <div className="gt-act__tiempo">
        {a.start_time && a.end_time && (
          <span>
            {a.start_time} a {a.end_time}
          </span>
        )}
        <strong>{duracion(a.duration)}</strong>
      </div>
      {a.description && <p className="gt-hilo__texto mb-1">{a.description}</p>}
      <p className="mz-small mz-faint mb-1">
        {nombreDe(a.author)} · {fechaHora(a.created_at)}
      </p>
      <ErrorEnLinea mensaje={error} className="mb-2" />
      <button
        type="button"
        className="gh-enlace"
        aria-expanded={comentariosAbiertos}
        onClick={() => setComentariosAbiertos((v) => !v)}
      >
        {cuenta > 0
          ? `${cuenta} comentario${cuenta === 1 ? "" : "s"}`
          : "Comentar"}
      </button>
      {comentariosAbiertos && (
        <ComentariosDeActividad
          tareaId={tareaId}
          actividad={a}
          onContado={() => setCuenta((c) => c + 1)}
        />
      )}
      {editando && (
        <EditarHoras
          actividad={a}
          tareaId={tareaId}
          onCerrar={() => setEditando(false)}
          onHecho={(actualizada) => {
            setEditando(false);
            onActualizada(actualizada);
          }}
        />
      )}
    </li>
  );
}

export function PanelActividades({
  tarea,
  soloLectura = false,
  onCerrar,
  onCambio,
  onRetroactiva,
}) {
  const { usuarioId, can, roles } = useTareas();
  const { motivos, errorMotivos, recargarMotivos } = useMotivos();
  const [actividades, setActividades] = useState(null);
  const [error, setError] = useState(null);
  const [objetivo, setObjetivo] = useState(null);
  const [errorObjetivo, setErrorObjetivo] = useState(null);
  const [fechaFin, setFechaFin] = useState(null);
  const [errorFechaFin, setErrorFechaFin] = useState(null);
  const [validando, setValidando] = useState(false);
  const [formato, setFormato] = useFormatoDeActividad();
  const [valores, setValores] = useState(REGISTRO_VACIO);
  const [errores, setErrores] = useState({});
  const [errorEnvio, setErrorEnvio] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);
  const formulario = useRef(null);
  const administra = can(TAREAS_ADMINISTRAR);
  const { agenda, error: agendaError } = useAgendaDelDia(
    soloLectura ? "duracion" : formato,
    hoy(),
  );

  const cargarActividades = useCallback(() => {
    setError(null);
    setActividades(null);
    tareasService
      .actividades(tarea.id)
      .then((lista) => setActividades(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setError(
          errorDeTareas(err, "No se pudieron cargar las actividades.").mensaje,
        ),
      );
  }, [tarea.id]);

  const cargarObjetivo = useCallback(() => {
    setErrorObjetivo(null);
    tareasService
      .tiempoObjetivo(tarea.id)
      .then(setObjetivo)
      .catch((err) =>
        setErrorObjetivo(
          errorDeTareas(err, "No se pudo cargar el Tiempo Objetivo.").mensaje,
        ),
      );
  }, [tarea.id]);

  const cargarFechaFin = useCallback(() => {
    setErrorFechaFin(null);
    tareasService
      .fechaFin(tarea.id)
      .then(setFechaFin)
      .catch((err) =>
        setErrorFechaFin(
          errorDeTareas(err, "No se pudo cargar la Fecha Fin.").mensaje,
        ),
      );
  }, [tarea.id]);

  useEffect(() => {
    cargarActividades();
    cargarObjetivo();
    cargarFechaFin();
  }, [cargarActividades, cargarObjetivo, cargarFechaFin]);

  const elegibles = useMemo(
    () => (motivos === null ? null : motivosElegibles(motivos, roles)),
    [motivos, roles],
  );
  const total = (actividades ?? []).reduce((s, a) => s + a.duration, 0);
  const limiteFija =
    tarea.type === "FIJA" &&
    (actividades?.length ?? 0) >= MAXIMO_REGISTROS_FIJA;
  const cruce = formato === "horario" ? cruceCon(agenda, valores) : null;

  function cambio() {
    cargarObjetivo();
    onCambio?.();
  }

  async function registrar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const e = validarRegistro(formato, valores, { cruce });
    setErrores(e);
    setErrorEnvio(null);
    if (Object.keys(e).length) {
      enfocarPrimerError(formulario.current);
      return;
    }
    enCurso.current = true;
    setEnviando(true);
    try {
      const nueva = await tareasService.registrarActividad(
        tarea.id,
        cuerpoDelRegistro(formato, valores),
      );
      setActividades((lista) => [...(lista ?? []), nueva]);
      setValores(REGISTRO_VACIO);
      cambio();
    } catch (err) {
      const fallo = errorDeTareas(err, "No se pudo registrar la actividad.");
      setErrores(fallo.campos);
      setErrorEnvio(fallo.mensaje);
      enfocarPrimerError(formulario.current);
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  const puedeValidar = objetivo?.can_validate || fechaFin?.can_validate;

  return (
    <PanelLateral
      titulo={tarea.title}
      subtitulo={
        soloLectura ? "Actividades registradas" : "Registro de actividades"
      }
      onCerrar={onCerrar}
    >
      <section className="gt-resumen" aria-label="Resumen de horas">
        <div className="gt-resumen__fila">
          <span>Tiempo total acumulado</span>
          <strong>{actividades ? duracion(total) : "—"}</strong>
        </div>
      </section>

      <section className="gt-bloque" aria-labelledby="gt-pa-objetivo">
        <h4 id="gt-pa-objetivo" className="gt-bloque__titulo">
          Tiempo objetivo
        </h4>
        <EstadoDeCarga
          cargando={!objetivo && !errorObjetivo}
          error={errorObjetivo}
          onReintentar={cargarObjetivo}
        />
        {objetivo && (
          <>
            <dl className="gh-tarjeta-kv">
              <dt>Objetivo</dt>
              <dd>
                {horas(objetivo.official_target)}{" "}
                <PillValidado validado={objetivo.is_validated} />
              </dd>
              <dt>Horas reales</dt>
              <dd>{horas(objetivo.real_hours)}</dd>
              {objetivo.real_hours > 0 && (
                <>
                  <dt>Desviación</dt>
                  <dd>
                    <Desviacion desviacion={objetivo.deviation} />
                  </dd>
                </>
              )}
            </dl>
            {objetivo.historical_deviation?.available && (
              <p className="mz-alert mz-alert--info mt-2 mb-0">
                <Icon name="info-circle" />
                <span>{objetivo.historical_deviation.recommendation}</span>
              </p>
            )}
            <Historial tipo="objetivo" entradas={objetivo.audit_history} />
          </>
        )}
      </section>

      <section className="gt-bloque" aria-labelledby="gt-pa-fecha">
        <h4 id="gt-pa-fecha" className="gt-bloque__titulo">
          Fecha fin
        </h4>
        <EstadoDeCarga
          cargando={!fechaFin && !errorFechaFin}
          error={errorFechaFin}
          onReintentar={cargarFechaFin}
        />
        {fechaFin && (
          <>
            <p className="mb-0">
              {fechaCorta(fechaFin.end_date)}{" "}
              <EstadoFechaFin estado={fechaFin.end_date_approval_status} />
            </p>
            <Historial tipo="fecha" entradas={fechaFin.audit_history} />
          </>
        )}
      </section>

      {puedeValidar && (
        <button
          type="button"
          className="btn btn-primary w-100 mb-3"
          onClick={() => setValidando(true)}
        >
          Validar tarea
        </button>
      )}

      <section aria-labelledby="gt-pa-lista">
        <h4 id="gt-pa-lista" className="gt-bloque__titulo">
          Actividades
        </h4>
        <EstadoDeCarga
          cargando={actividades === null && !error}
          error={error}
          onReintentar={cargarActividades}
          vacio={actividades?.length === 0}
          textoVacio="Todavía no hay actividades registradas."
        />
        {actividades?.length > 0 && (
          <ol className="gt-acts">
            {actividades.map((a) => (
              <ActividadItem
                key={a.id}
                actividad={a}
                tareaId={tarea.id}
                motivos={motivos}
                usuarioId={usuarioId}
                administra={administra}
                onEliminada={(id) => {
                  setActividades((l) => l.filter((x) => x.id !== id));
                  cambio();
                }}
                onActualizada={(nueva) => {
                  setActividades((l) =>
                    l.map((x) => (x.id === nueva.id ? nueva : x)),
                  );
                  cambio();
                }}
              />
            ))}
          </ol>
        )}
      </section>

      {!soloLectura && actividades !== null && limiteFija && (
        <div className="mz-alert mz-alert--warn mt-3" role="status">
          <Icon name="lock" />
          <span>
            Esta tarea fija ya alcanzó el máximo de {MAXIMO_REGISTROS_FIJA}{" "}
            registros de horas.
          </span>
        </div>
      )}
      {!soloLectura &&
        actividades !== null &&
        !limiteFija &&
        elegibles?.length === 0 && <SinMotivos administra={administra} />}
      {!soloLectura &&
        tarea.type === "SEGUIMIENTO" &&
        tarea.assigned_to?.id === usuarioId &&
        onRetroactiva && (
          <p className="mt-3 mb-0">
            <button
              type="button"
              className="gh-enlace px-0"
              onClick={() => onRetroactiva(tarea)}
            >
              ¿Olvidó registrar un día anterior?
            </button>
          </p>
        )}
      {!soloLectura &&
        actividades !== null &&
        !limiteFija &&
        elegibles?.length !== 0 && (
          <form
            ref={formulario}
            className="gt-bloque mt-3"
            onSubmit={registrar}
            aria-labelledby="gt-pa-nueva"
            noValidate
          >
            <h4 id="gt-pa-nueva" className="gt-bloque__titulo">
              Registrar actividad
            </h4>
            <CamposDeHoras
              idBase="gt-pa"
              formato={formato}
              onFormato={setFormato}
              valores={valores}
              onCambio={setValores}
              elegibles={elegibles}
              errorMotivos={errorMotivos}
              onReintentarMotivos={recargarMotivos}
              errores={errores}
              agendaError={agendaError}
              cruce={cruce}
            />
            <ErrorEnLinea mensaje={errorEnvio} className="mt-2" />
            <button
              type="submit"
              className="btn btn-primary w-100 mt-3"
              disabled={enviando}
            >
              {enviando ? "Registrando…" : "Registrar actividad"}
            </button>
          </form>
        )}

      {validando && (
        <ValidarTarea
          tarea={tarea}
          onCerrar={() => setValidando(false)}
          onCambio={() => {
            cargarObjetivo();
            cargarFechaFin();
            onCambio?.();
          }}
        />
      )}
    </PanelLateral>
  );
}
