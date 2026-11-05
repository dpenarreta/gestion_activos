/*
 * Lo que comparten el registro de horas del panel de actividades y el
 * registro retroactivo: el motivo (solo los de sus roles), la duración o el
 * horario, la vista previa de la duración y el aviso de cruce con otra
 * actividad del mismo día (`activities/day-schedule/`). El servidor vuelve a
 * revisar el motivo, la duración y el cruce al guardar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { Link } from "react-router-dom";

import { errorDeTareas, tareasService } from "../../../api/tareasService";
import { Campo } from "../../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { RUTA_GESTION_HUMANA } from "../../../modulos/permisosGestionHumana";
import { duracion, minutosDe, seSolapan } from "./tareasComunes";

/**
 * Sin motivos asignados a sus roles no se puede registrar horas: en vez de
 * un formulario que no se puede enviar, se dice por qué y a quién pedirlo.
 */
export function SinMotivos({ administra }) {
  return (
    <div className="mz-alert mz-alert--warn" role="status">
      <Icon name="exclamation-triangle" />
      <span>
        No tiene motivos asignados para registrar horas. Pídale al Administrador
        de Gestión Humana que asigne un motivo a su rol.
        {administra && (
          <>
            {" "}
            <Link to={`${RUTA_GESTION_HUMANA}/ajustes-de-tareas`}>
              Ir a Ajustes de tareas
            </Link>
          </>
        )}
      </span>
    </div>
  );
}

const CLAVE_FORMATO = "gestion_humana:formato_actividad";

/** Duración (horas y minutos) u horario (inicio y fin): la preferencia de
 * cada persona, como en Nexo. Se recuerda en este equipo; no es un dato
 * sensible. */
export function useFormatoDeActividad() {
  const [formato, setFormato] = useState(() => {
    try {
      return window.localStorage.getItem(CLAVE_FORMATO) === "horario"
        ? "horario"
        : "duracion";
    } catch {
      return "duracion";
    }
  });
  const cambiar = useCallback((valor) => {
    setFormato(valor);
    try {
      window.localStorage.setItem(CLAVE_FORMATO, valor);
    } catch {
      // Sin almacenamiento: vale solo para esta visita.
    }
  }, []);
  return [formato, cambiar];
}

export const REGISTRO_VACIO = {
  reason: "",
  hours: "",
  minutes: "",
  start_time: "",
  end_time: "",
  description: "",
};

function entero(valor, max) {
  if (valor === "") return "";
  const n = Math.trunc(Number(valor));
  if (Number.isNaN(n)) return "";
  return String(Math.min(max, Math.max(0, n)));
}

/** Los minutos que suma el registro, o `null` si todavía no hay duración. */
export function minutosDelRegistro(formato, valores) {
  if (formato === "horario") {
    const a = minutosDe(valores.start_time);
    const b = minutosDe(valores.end_time);
    if (a === null || b === null) return null;
    return b - a > 0 ? b - a : null;
  }
  const total =
    (Number(valores.hours) || 0) * 60 + (Number(valores.minutes) || 0);
  return total > 0 ? total : null;
}

/** La agenda del día (para avisar de cruces) cuando se registra con
 * horario. Si no carga, se sigue: el servidor revisa el cruce igual. */
export function useAgendaDelDia(formato, fecha) {
  const [agenda, setAgenda] = useState([]);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (formato !== "horario") return undefined;
    let vigente = true;
    setError(null);
    tareasService
      .agendaDelDia(fecha)
      .then((lista) => vigente && setAgenda(Array.isArray(lista) ? lista : []))
      .catch(
        (err) =>
          vigente &&
          setError(
            errorDeTareas(
              err,
              "No se pudo revisar su agenda del día; el cruce de horarios se revisará al guardar.",
            ).mensaje,
          ),
      );
    return () => {
      vigente = false;
    };
  }, [formato, fecha, version]);
  return { agenda, error, recargar: () => setVersion((v) => v + 1) };
}

/** El cruce con otra actividad del día, si lo hay. */
export function cruceCon(agenda, valores) {
  if (!valores.start_time || !valores.end_time) return null;
  return (
    agenda.find((a) =>
      seSolapan(valores.start_time, valores.end_time, a.startTime, a.endTime),
    ) ?? null
  );
}

export function mensajeDeCruce(cruce) {
  return `Este horario se cruza con una actividad registrada de ${cruce.startTime} a ${cruce.endTime} en la tarea «${cruce.taskTitle}». Ajuste el horario.`;
}

/**
 * Los campos del registro. `idBase` distingue los del panel de los de la
 * ventana retroactiva (los dos pueden estar abiertos).
 */
export function CamposDeHoras({
  idBase,
  formato,
  onFormato,
  valores,
  onCambio,
  elegibles,
  errorMotivos,
  onReintentarMotivos,
  errores = {},
  agendaError,
  cruce,
  descripcionObligatoria = false,
}) {
  const minutos = useMemo(
    () => minutosDelRegistro(formato, valores),
    [formato, valores],
  );
  const cambiar = (campo, transformar) => (evento) =>
    onCambio({
      ...valores,
      [campo]: transformar
        ? transformar(evento.target.value)
        : evento.target.value,
    });

  return (
    <>
      <Campo
        id={`${idBase}-motivo`}
        etiqueta="Motivo"
        obligatorio
        error={errores.reason}
      >
        <select
          className="form-select"
          value={valores.reason}
          onChange={cambiar("reason")}
        >
          <option value="">
            {elegibles === null
              ? "Cargando motivos…"
              : elegibles.length
                ? "Elija un motivo"
                : "No hay motivos disponibles para su rol"}
          </option>
          {(elegibles ?? []).map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </Campo>
      {errorMotivos && (
        <EstadoDeCarga
          error={errorMotivos}
          onReintentar={onReintentarMotivos}
        />
      )}

      <fieldset className="mt-3">
        <legend className="form-label gt-legend">Cómo registra</legend>
        <div className="gt-segmentado">
          {[
            ["duracion", "Duración"],
            ["horario", "Hora de inicio y fin"],
          ].map(([valor, texto]) => (
            <label key={valor} className="gt-segmentado__opcion">
              <input
                type="radio"
                name={`${idBase}-formato`}
                value={valor}
                checked={formato === valor}
                onChange={() => onFormato(valor)}
              />
              <span>{texto}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {formato === "horario" ? (
        <div className="gt-form-grid mt-2">
          <Campo
            id={`${idBase}-inicio`}
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
            id={`${idBase}-fin`}
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
      ) : (
        <div className="gt-form-grid mt-2">
          <Campo id={`${idBase}-horas`} etiqueta="Horas" error={errores.hours}>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={23}
              className="form-control"
              value={valores.hours}
              onChange={cambiar("hours", (v) => entero(v, 23))}
            />
          </Campo>
          <Campo
            id={`${idBase}-minutos`}
            etiqueta="Minutos"
            error={errores.minutes}
          >
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              className="form-control"
              value={valores.minutes}
              onChange={cambiar("minutes", (v) => entero(v, 59))}
            />
          </Campo>
        </div>
      )}
      {cruce && (
        <div className="mz-alert mz-alert--bad mt-2" role="alert">
          <span>{mensajeDeCruce(cruce)}</span>
        </div>
      )}
      {formato === "horario" && agendaError && (
        <p className="mz-small mz-faint mt-2 mb-0">{agendaError}</p>
      )}
      <p className="gt-duracion mt-2" aria-live="polite">
        <span>Duración calculada</span>
        <strong>{minutos ? duracion(minutos) : "—"}</strong>
      </p>

      <Campo
        id={`${idBase}-descripcion`}
        etiqueta="Descripción"
        obligatorio={descripcionObligatoria}
        error={errores.description}
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
    </>
  );
}

/** Revisa lo que se puede revisar antes de enviar; devuelve los errores por
 * campo. */
export function validarRegistro(formato, valores, { cruce, descripcion }) {
  const e = {};
  if (!valores.reason) e.reason = "Elija el motivo.";
  if (formato === "horario") {
    if (!valores.start_time) e.start_time = "Indique la hora de inicio.";
    if (!valores.end_time) e.end_time = "Indique la hora de fin.";
    const a = minutosDe(valores.start_time);
    const b = minutosDe(valores.end_time);
    if (a !== null && b !== null && b <= a) {
      e.end_time = "Debe ser posterior a la hora de inicio.";
    }
    if (!e.end_time && cruce) e.end_time = mensajeDeCruce(cruce);
  } else if (!minutosDelRegistro(formato, valores)) {
    e.hours = "La duración debe ser mayor a 0.";
  }
  if (descripcion && !valores.description.trim()) {
    e.description = "La descripción es obligatoria en un registro retroactivo.";
  }
  return e;
}

/** El cuerpo que espera el servidor (`ActivityCreateSerializer`). */
export function cuerpoDelRegistro(formato, valores) {
  const minutos = minutosDelRegistro(formato, valores) ?? 0;
  return {
    reason: valores.reason,
    hours: Math.floor(minutos / 60),
    minutes: minutos % 60,
    description: valores.description.trim(),
    start_time: formato === "horario" ? valores.start_time : null,
    end_time: formato === "horario" ? valores.end_time : null,
  };
}
