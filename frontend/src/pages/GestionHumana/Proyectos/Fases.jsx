/*
 * Las fases de un proyecto (`ProjectPhasesTab` y `PhaseDetailModal` de
 * Nexo): tarjetas con estado, responsable, tiempo objetivo y registrado,
 * progreso y fecha objetivo. Quien gestiona el proyecto las agrega, edita,
 * cambia de estado, ajusta su progreso y elimina; el servidor lo vuelve a
 * revisar. Las horas registradas y quiénes participaron salen de las
 * actividades de la fase.
 */
import { useEffect, useRef, useState } from "react";

import {
  errorDeProyectos,
  proyectosGhService,
} from "../../../api/proyectosGhService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { confirmar } from "../../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { ErrorEnLinea, MenuDeAcciones, fechaHora } from "../comunes";
import { PreviaHoras } from "../Tareas/Indicadores";
import {
  AYUDA_HORAS,
  HORAS_INVALIDAS,
  aMedianocheUTC,
  diaUTC,
  duracion,
  fechaCorta,
  horas,
  horasATexto,
  horasValidas,
  textoAHoras,
} from "../Tareas/tareasComunes";
import { Ventana } from "../Tareas/Ventanas";
import { useMiembros } from "./ContextoProyectos";
import {
  ESTADO_FASE,
  ESTADOS_FASE,
  TONO_ESTADO_FASE,
  nombreDe,
} from "./proyectosComunes";

const idTarjetaFase = (id) => `gp-fase-${id}`;

export function PillEstadoFase({ estado }) {
  return (
    <span
      className={`mz-pill ${TONO_ESTADO_FASE[estado] ?? "mz-pill--neutral"}`}
    >
      {ESTADO_FASE[estado] ?? estado}
    </span>
  );
}

export function Fases({ proyecto, onActualizado }) {
  const fases = proyecto.phases ?? [];
  const puede = proyecto.can_manage;
  const [formulario, setFormulario] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);
  const enCurso = useRef(false);
  const titulo = useRef(null);

  const reemplazar = (fase) =>
    onActualizado((p) => ({
      ...p,
      phases: p.phases.some((f) => f.id === fase.id)
        ? p.phases.map((f) => (f.id === fase.id ? fase : f))
        : [...p.phases, fase],
    }));

  async function cambiar(fase, cambios, texto) {
    if (enCurso.current) return;
    enCurso.current = true;
    setError(null);
    try {
      const guardada = await proyectosGhService.actualizarFase(
        proyecto.id,
        fase.id,
        cambios,
      );
      reemplazar(guardada);
      setMensaje(texto(guardada));
    } catch (err) {
      setError(errorDeProyectos(err, "No se pudo actualizar la fase.").mensaje);
    } finally {
      enCurso.current = false;
    }
  }

  async function eliminar(fase) {
    if (enCurso.current) return;
    const seguir = await confirmar({
      titulo: `¿Eliminar la fase «${fase.name}»?`,
      mensaje:
        "Sus actividades se conservan en el proyecto, pero quedan sin fase. No se puede deshacer.",
      accion: "Eliminar fase",
    });
    if (!seguir) return;
    enCurso.current = true;
    setError(null);
    try {
      await proyectosGhService.eliminarFase(proyecto.id, fase.id);
      onActualizado((p) => ({
        ...p,
        phases: p.phases.filter((f) => f.id !== fase.id),
      }));
      setMensaje(`Fase «${fase.name}» eliminada.`);
      // La tarjeta desapareció con el foco: vuelve al título de la sección.
      setTimeout(() => titulo.current?.focus(), 0);
    } catch (err) {
      setError(errorDeProyectos(err, "No se pudo eliminar la fase.").mensaje);
    } finally {
      enCurso.current = false;
    }
  }

  return (
    <div className="mz-stack">
      <div className="gp-seccion-cabeza">
        <h3 ref={titulo} tabIndex={-1} className="gp-subtitulo">
          Fases
        </h3>
        {puede && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setFormulario({})}
          >
            <Icon name="plus-lg" /> Agregar fase
          </button>
        )}
      </div>
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

      {fases.length === 0 ? (
        <div className="mz-empty">
          <p className={puede ? "mb-2" : "mb-0"}>
            Este proyecto todavía no tiene fases.
          </p>
          {puede && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setFormulario({})}
            >
              Agregar la primera fase
            </button>
          )}
        </div>
      ) : (
        <ul className="gp-fases">
          {fases.map((fase) => (
            <TarjetaFase
              key={fase.id}
              fase={fase}
              puede={puede}
              onVer={() => setDetalle(fase)}
              onEditar={() => setFormulario({ fase })}
              onEliminar={() => eliminar(fase)}
              onEstado={(estado) =>
                cambiar(
                  fase,
                  { status: estado },
                  (g) => `Fase «${g.name}» movida a ${ESTADO_FASE[g.status]}.`,
                )
              }
              onProgreso={(valor) =>
                cambiar(
                  fase,
                  { progress: valor },
                  (g) => `Progreso de «${g.name}»: ${g.progress} %.`,
                )
              }
            />
          ))}
        </ul>
      )}

      {formulario && (
        <FormularioFase
          proyecto={proyecto}
          fase={formulario.fase}
          onCerrar={() => setFormulario(null)}
          onGuardada={(fase, nueva) => {
            setFormulario(null);
            reemplazar(fase);
            setMensaje(
              nueva ? `Fase «${fase.name}» agregada.` : "Fase actualizada.",
            );
          }}
        />
      )}
      {detalle && (
        <DetalleFase
          proyectoId={proyecto.id}
          fase={detalle}
          onCerrar={() => setDetalle(null)}
        />
      )}
    </div>
  );
}

function TarjetaFase({
  fase,
  puede,
  onVer,
  onEditar,
  onEliminar,
  onEstado,
  onProgreso,
}) {
  const [progreso, setProgreso] = useState(fase.progress ?? 0);
  useEffect(() => setProgreso(fase.progress ?? 0), [fase.progress]);
  const idProgreso = `gp-progreso-${fase.id}`;
  const participantes = fase.participants ?? [];

  return (
    <li className="gp-fase" id={idTarjetaFase(fase.id)}>
      <div className="gp-fase__cabeza">
        <h4 className="gp-fase__titulo">{fase.name}</h4>
        {puede ? (
          <MenuDeAcciones
            etiqueta={`Estado de «${fase.name}»: ${ESTADO_FASE[fase.status]}. Cambiar estado`}
            contenido={
              <>
                {ESTADO_FASE[fase.status] ?? fase.status}
                <Icon name="chevron-down" />
              </>
            }
            acciones={ESTADOS_FASE.filter((e) => e !== fase.status).map(
              (e) => ({
                texto: `Mover a ${ESTADO_FASE[e]}`,
                onClick: () => onEstado(e),
              }),
            )}
          />
        ) : (
          <PillEstadoFase estado={fase.status} />
        )}
      </div>
      <p className="mz-small mb-1">
        <span className="mz-faint">Responsable: </span>
        {fase.responsible ? nombreDe(fase.responsible) : "Sin asignar"}
      </p>
      {participantes.length > 0 && (
        <p className="gp-marcas mb-1">
          {participantes.slice(0, 3).map((p) => (
            <span key={p.id} className="mz-pill mz-pill--neutral">
              {p.name}
            </span>
          ))}
          {participantes.length > 3 && (
            <span className="mz-pill mz-pill--neutral">
              +{participantes.length - 3}
              <span className="visually-hidden"> participantes más</span>
            </span>
          )}
        </p>
      )}
      <p className="mz-small d-flex flex-wrap gap-3 mb-1">
        <span>
          <span className="mz-faint">Objetivo: </span>
          {fase.target_time_hours != null ? horas(fase.target_time_hours) : "—"}
        </span>
        <span>
          <span className="mz-faint">Registrado: </span>
          {duracion(fase.registered_minutes)}
        </span>
      </p>
      {puede ? (
        <form
          className="gp-progreso"
          onSubmit={(e) => {
            e.preventDefault();
            onProgreso(progreso);
          }}
        >
          <label htmlFor={idProgreso} className="mz-small">
            Progreso: <strong>{progreso} %</strong>
          </label>
          <input
            id={idProgreso}
            type="range"
            className="form-range"
            min={0}
            max={100}
            step={5}
            value={progreso}
            aria-valuetext={`${progreso} %`}
            onChange={(e) => setProgreso(Number(e.target.value))}
          />
          {progreso !== (fase.progress ?? 0) && (
            <button type="submit" className="btn btn-outline-primary btn-sm">
              Guardar progreso
            </button>
          )}
        </form>
      ) : (
        <div>
          <p className="mz-small mb-1">
            <span className="mz-faint">Progreso: </span>
            {fase.progress ?? 0} %
          </p>
          <span className="gh-avance d-block" aria-hidden="true">
            <span style={{ width: `${fase.progress ?? 0}%` }} />
          </span>
        </div>
      )}
      <p className="mz-small mz-faint mb-0">
        {fase.target_date
          ? `Fecha objetivo: ${fechaCorta(fase.target_date)}`
          : "Sin fecha objetivo"}
      </p>
      <div className="gp-fase__pie">
        <button
          type="button"
          className="btn btn-link btn-sm px-0"
          onClick={onVer}
        >
          Ver detalle<span className="visually-hidden"> de «{fase.name}»</span>
        </button>
        {puede && (
          <MenuDeAcciones
            etiqueta={`Más acciones de la fase «${fase.name}»`}
            acciones={[
              { texto: "Editar fase", onClick: onEditar },
              { texto: "Eliminar fase", onClick: onEliminar, peligro: true },
            ]}
          />
        )}
      </div>
    </li>
  );
}

function FormularioFase({ proyecto, fase, onCerrar, onGuardada }) {
  const editando = Boolean(fase);
  const { miembros } = useMiembros();
  const [valores, setValores] = useState(() => ({
    name: fase?.name ?? "",
    responsible: fase?.responsible ? String(fase.responsible.id) : "",
    start_date: fase?.start_date ? diaUTC(fase.start_date) : "",
    target_date: fase?.target_date ? diaUTC(fase.target_date) : "",
    target_time_hours:
      fase?.target_time_hours != null
        ? horasATexto(fase.target_time_hours)
        : "",
    notes: fase?.notes ?? "",
  }));
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  const panel = useRef(null);

  // Quien se puede elegir: las personas elegibles o, si no cargan, quienes
  // ya participan en el proyecto (como en Nexo).
  const personas = (
    miembros?.length ? miembros : proyecto.participants.map((p) => p.user)
  ).filter(Boolean);

  const cambiar = (campo) => (e) =>
    setValores((v) => ({ ...v, [campo]: e.target.value }));

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const e = {};
    if (!valores.name.trim()) e.name = "Escriba el nombre de la fase.";
    if (
      valores.start_date &&
      valores.target_date &&
      valores.target_date < valores.start_date
    )
      e.target_date = "Debe ser igual o posterior a la fecha de inicio.";
    if (
      valores.target_time_hours.trim() &&
      !horasValidas(valores.target_time_hours)
    )
      e.target_time_hours = HORAS_INVALIDAS;
    setErrores(e);
    setError(null);
    if (Object.keys(e).length) {
      enfocarPrimerError(panel.current);
      return;
    }
    const datos = {
      name: valores.name.trim(),
      responsible: valores.responsible ? Number(valores.responsible) : null,
      start_date: valores.start_date
        ? aMedianocheUTC(valores.start_date)
        : null,
      target_date: valores.target_date
        ? aMedianocheUTC(valores.target_date)
        : null,
      target_time_hours: valores.target_time_hours.trim()
        ? textoAHoras(valores.target_time_hours)
        : null,
      notes: valores.notes.trim(),
    };
    enCurso.current = true;
    setGuardando(true);
    try {
      const guardada = editando
        ? await proyectosGhService.actualizarFase(proyecto.id, fase.id, datos)
        : await proyectosGhService.crearFase(proyecto.id, datos);
      onGuardada(guardada, !editando);
    } catch (err) {
      const fallo = errorDeProyectos(err, "No se pudo guardar la fase.");
      setErrores(fallo.campos);
      setError(fallo.mensaje);
      enfocarPrimerError(panel.current);
      setGuardando(false);
      enCurso.current = false;
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo={editando ? "Editar fase" : "Nueva fase"}
      subtitulo={proyecto.name}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar={editando ? "Guardar cambios" : "Crear fase"}
      isSaving={guardando}
    >
      <div ref={panel}>
        <LeyendaObligatorios />
        <ErrorEnLinea mensaje={error} className="mt-2" />
        <Campo
          id="gp-fase-nombre"
          etiqueta="Nombre"
          obligatorio
          error={errores.name}
          className="mt-3"
        >
          <input
            className="form-control"
            maxLength={255}
            value={valores.name}
            onChange={cambiar("name")}
            data-autofocus
          />
        </Campo>
        <div className="gt-form-grid mt-3">
          <Campo
            id="gp-fase-responsable"
            etiqueta="Responsable"
            error={errores.responsible}
          >
            <select
              className="form-select"
              value={valores.responsible}
              onChange={cambiar("responsible")}
            >
              <option value="">Sin responsable</option>
              {personas.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {nombreDe(p)}
                </option>
              ))}
            </select>
          </Campo>
          <div>
            <Campo
              id="gp-fase-horas"
              etiqueta="Tiempo objetivo (HH.MM)"
              error={errores.target_time_hours}
              ayuda={AYUDA_HORAS}
            >
              <input
                className="form-control"
                inputMode="decimal"
                value={valores.target_time_hours}
                onChange={cambiar("target_time_hours")}
                placeholder="Ej.: 8.00"
              />
            </Campo>
            <PreviaHoras texto={valores.target_time_hours} />
          </div>
          <Campo
            id="gp-fase-inicio"
            etiqueta="Fecha de inicio"
            error={errores.start_date}
          >
            <input
              type="date"
              className="form-control"
              value={valores.start_date}
              onChange={cambiar("start_date")}
            />
          </Campo>
          <Campo
            id="gp-fase-objetivo"
            etiqueta="Fecha objetivo"
            error={errores.target_date}
          >
            <input
              type="date"
              className="form-control"
              value={valores.target_date}
              min={valores.start_date || undefined}
              onChange={cambiar("target_date")}
            />
          </Campo>
        </div>
        <Campo
          id="gp-fase-notas"
          etiqueta="Comentarios"
          error={errores.notes}
          className="mt-3"
        >
          <textarea
            className="form-control"
            rows={2}
            maxLength={5000}
            value={valores.notes}
            onChange={cambiar("notes")}
          />
        </Campo>
      </div>
    </ModalDialog>
  );
}

/** El detalle de una fase con sus actividades. */
function DetalleFase({ proyectoId, fase, onCerrar }) {
  const [actividades, setActividades] = useState(null);
  const [error, setError] = useState(null);

  const cargar = () => {
    setError(null);
    setActividades(null);
    proyectosGhService
      .actividades(proyectoId)
      .then((lista) =>
        setActividades(
          (Array.isArray(lista) ? lista : []).filter(
            (a) => a.phase_id === fase.id,
          ),
        ),
      )
      .catch((err) =>
        setError(
          errorDeProyectos(err, "No se pudieron cargar las actividades.")
            .mensaje,
        ),
      );
  };

  useEffect(() => {
    cargar();
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ventana titulo={fase.name} onCerrar={onCerrar} ancha>
      <div className="mz-kv-grid">
        <div className="mz-kv">
          <span className="mz-kv-label">Estado</span>
          <PillEstadoFase estado={fase.status} />
        </div>
        <div className="mz-kv">
          <span className="mz-kv-label">Responsable</span>
          {fase.responsible ? nombreDe(fase.responsible) : "Sin asignar"}
        </div>
        <div className="mz-kv">
          <span className="mz-kv-label">Tiempo objetivo</span>
          {fase.target_time_hours != null ? horas(fase.target_time_hours) : "—"}
        </div>
        <div className="mz-kv">
          <span className="mz-kv-label">Tiempo registrado</span>
          {duracion(fase.registered_minutes)}
        </div>
        <div className="mz-kv">
          <span className="mz-kv-label">Progreso</span>
          {fase.progress ?? 0} %
        </div>
        <div className="mz-kv">
          <span className="mz-kv-label">Fecha objetivo</span>
          {fase.target_date ? fechaCorta(fase.target_date) : "—"}
        </div>
        {fase.participants?.length > 0 && (
          <div className="mz-kv mz-kv--full">
            <span className="mz-kv-label">Participantes</span>
            {fase.participants.map((p) => p.name).join(", ")}
          </div>
        )}
        {fase.notes && (
          <div className="mz-kv mz-kv--full">
            <span className="mz-kv-label">Comentarios</span>
            <span className="gh-pre">{fase.notes}</span>
          </div>
        )}
      </div>
      <h4 className="gp-subtitulo mt-3">Actividades de esta fase</h4>
      <EstadoDeCarga
        cargando={actividades === null && !error}
        error={error}
        onReintentar={cargar}
        vacio={actividades?.length === 0}
        textoVacio="Sin actividades registradas en esta fase."
      />
      {actividades?.length > 0 && (
        <ul className="gp-lista">
          {actividades.map((a) => (
            <li key={a.id} className="gh-recuadro">
              <p className="mb-1">{a.description}</p>
              <p className="mz-small mz-faint mb-0">
                {nombreDe(a.author)} · {fechaHora(a.created_at)} ·{" "}
                {duracion(a.duration)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Ventana>
  );
}
