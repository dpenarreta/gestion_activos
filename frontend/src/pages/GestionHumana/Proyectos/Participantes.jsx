/*
 * Los participantes de un proyecto (`ProjectParticipantsTab` de Nexo).
 * Quien gestiona agrega y quita (nunca al responsable: el servidor responde
 * 409); quitar a alguien le saca el acceso y queda en el historial. También
 * se es participante al registrar una actividad.
 */
import { useRef, useState } from "react";

import {
  errorDeProyectos,
  proyectosGhService,
} from "../../../api/proyectosGhService";
import { confirmar } from "../../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { ErrorEnLinea, fechaHora } from "../comunes";
import { iniciales } from "../Tareas/tareasComunes";
import { useMiembros } from "./ContextoProyectos";
import { nombreDe, rolDe } from "./proyectosComunes";

export function Participantes({ proyecto, onActualizado }) {
  if (proyecto.can_manage) {
    return <ConGestion proyecto={proyecto} onActualizado={onActualizado} />;
  }
  return <Lista proyecto={proyecto} />;
}

function Lista({ proyecto, onQuitar, ocupado }) {
  const participantes = proyecto.participants ?? [];
  if (!participantes.length) {
    return (
      <p className="mz-empty mb-0">
        Este proyecto todavía no tiene participantes.
      </p>
    );
  }
  return (
    <ul className="gp-personas">
      {participantes.map((p) => {
        const esResponsable = p.user?.id === proyecto.responsible?.id;
        return (
          <li key={p.id} className="gp-persona">
            <span className="gt-avatar" aria-hidden="true">
              {iniciales(nombreDe(p.user))}
            </span>
            <span className="gt-min0 flex-grow-1">
              <span className="mz-strong d-block">
                {nombreDe(p.user)}
                {esResponsable && (
                  <span className="mz-pill mz-pill--info ms-2">
                    Responsable
                  </span>
                )}
              </span>
              <span className="mz-small mz-faint d-block">
                {[rolDe(p.user), `agregado por ${nombreDe(p.added_by)}`]
                  .filter(Boolean)
                  .join(" · ")}
                {p.added_at && ` · ${fechaHora(p.added_at)}`}
              </span>
            </span>
            {onQuitar && !esResponsable && (
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                disabled={ocupado === p.id}
                onClick={() => onQuitar(p)}
              >
                Quitar
                <span className="visually-hidden"> a {nombreDe(p.user)}</span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ConGestion({ proyecto, onActualizado }) {
  const { miembros, errorMiembros, recargarMiembros } = useMiembros();
  const [elegido, setElegido] = useState("");
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const enCurso = useRef(false);
  const selector = useRef(null);
  const titulo = useRef(null);

  const yaEstan = new Set((proyecto.participants ?? []).map((p) => p.user?.id));
  const disponibles = (miembros ?? [])
    .filter((m) => !yaEstan.has(m.id))
    .sort((a, b) => nombreDe(a).localeCompare(nombreDe(b), "es"));

  async function agregar(evento) {
    evento.preventDefault();
    if (!elegido || enCurso.current) return;
    enCurso.current = true;
    setOcupado("agregar");
    setError(null);
    try {
      const nuevo = await proyectosGhService.agregarParticipante(
        proyecto.id,
        Number(elegido),
      );
      onActualizado((p) => ({
        ...p,
        participants: [...(p.participants ?? []), nuevo],
      }));
      setElegido("");
      setMensaje(`${nombreDe(nuevo.user)} se agregó al proyecto.`);
      selector.current?.focus();
    } catch (err) {
      setError(
        errorDeProyectos(err, "No se pudo agregar el participante.").mensaje,
      );
    } finally {
      enCurso.current = false;
      setOcupado(null);
    }
  }

  async function quitar(participante) {
    if (enCurso.current) return;
    const nombre = nombreDe(participante.user);
    const seguir = await confirmar({
      titulo: `¿Quitar a ${nombre} del proyecto?`,
      mensaje:
        "Pierde el acceso al proyecto y queda registrado en el historial. Se puede volver a agregar después.",
      accion: "Quitar",
    });
    if (!seguir) return;
    enCurso.current = true;
    setOcupado(participante.id);
    setError(null);
    try {
      await proyectosGhService.quitarParticipante(proyecto.id, participante.id);
      onActualizado((p) => ({
        ...p,
        participants: p.participants.filter((x) => x.id !== participante.id),
      }));
      setMensaje(`${nombre} se quitó del proyecto.`);
      // El botón «Quitar» desapareció con su fila: el foco vuelve arriba.
      setTimeout(() => titulo.current?.focus(), 0);
    } catch (err) {
      setError(
        errorDeProyectos(err, "No se pudo quitar el participante.").mensaje,
      );
    } finally {
      enCurso.current = false;
      setOcupado(null);
    }
  }

  return (
    <div className="mz-stack">
      <h3 ref={titulo} tabIndex={-1} className="gp-subtitulo">
        Participantes ({proyecto.participants?.length ?? 0})
      </h3>
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
      {errorMiembros ? (
        <EstadoDeCarga error={errorMiembros} onReintentar={recargarMiembros} />
      ) : miembros === null ? (
        <EstadoDeCarga cargando />
      ) : disponibles.length > 0 ? (
        <form className="gp-agregar" onSubmit={agregar}>
          <div className="flex-grow-1">
            <label className="form-label" htmlFor="gp-agregar-persona">
              Agregar participante
            </label>
            <select
              ref={selector}
              id="gp-agregar-persona"
              className="form-select"
              value={elegido}
              onChange={(e) => setElegido(e.target.value)}
            >
              <option value="">Elija una persona</option>
              {disponibles.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {nombreDe(m)}
                  {rolDe(m) ? ` · ${rolDe(m)}` : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!elegido || ocupado === "agregar"}
          >
            {ocupado === "agregar" ? "Agregando…" : "Agregar"}
          </button>
        </form>
      ) : (
        <p className="mz-small mz-faint mb-0">
          Todas las personas disponibles ya participan.
        </p>
      )}
      <Lista proyecto={proyecto} onQuitar={quitar} ocupado={ocupado} />
    </div>
  );
}
