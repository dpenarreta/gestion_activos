/*
 * «Convertir en tarea» (`ConvertReminderToTaskModal` de Nexo): crea la tarea
 * en Tareas, asignada a uno mismo, con el título del recordatorio (se puede
 * cambiar), el tipo, la frecuencia, las fechas y las horas estimadas. La
 * prioridad la traduce el servidor. Solo con acceso a Tareas
 * (`can_convert_to_task`) y una vez: si ya se convirtió, el servidor responde
 * 409 y se dice.
 */
import { useId, useRef, useState } from "react";

import {
  errorDeEscritorio,
  escritorioService,
} from "../../../api/escritorioService";
import {
  Campo,
  LeyendaObligatorios,
} from "../../../components/common/Campo/Campo";
import { Icon } from "../../../components/common/Icon/Icon";
import { Ventana } from "../Tareas/Ventanas";
import {
  FRECUENCIA,
  FRECUENCIAS,
  TIPO,
  aMedianocheUTC,
  hoy,
} from "../Tareas/tareasComunes";

const ORDEN = [
  "title",
  "type",
  "frequency",
  "start_date",
  "end_date",
  "estimated_hours",
];

/** El día local de una fecha ISO (AAAA-MM-DD). */
function diaLocal(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return hoy();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ConvertirEnTarea({ recordatorio, onCerrar, onConvertido }) {
  const base = useId();
  const ids = Object.fromEntries(
    [...ORDEN, "formulario"].map((c) => [c, `${base}-${c}`]),
  );
  const inicio = hoy();
  const vence = diaLocal(recordatorio.due_at);
  const [valores, setValores] = useState({
    title: recordatorio.title,
    type: "SEGUIMIENTO",
    frequency: "PUNTUAL",
    start_date: inicio,
    end_date: vence < inicio ? inicio : vence,
    estimated_hours: "1",
  });
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);

  function cambiar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    setErrores((e) => {
      const resto = { ...e };
      delete resto[campo];
      return resto;
    });
  }

  function validar() {
    const e = {};
    if (!valores.start_date) e.start_date = "Elija la fecha de inicio.";
    if (!valores.end_date) e.end_date = "Elija la fecha de fin.";
    else if (valores.start_date && valores.end_date < valores.start_date)
      e.end_date = "La fecha de fin no puede ser anterior a la de inicio.";
    const horas = Number(String(valores.estimated_hours).replace(",", "."));
    if (!valores.estimated_hours || !Number.isFinite(horas) || horas <= 0)
      e.estimated_hours = "Las horas estimadas tienen que ser más que cero.";
    return e;
  }

  function enfocar(campos) {
    const primero = ORDEN.find((c) => campos[c]);
    if (primero) document.getElementById(ids[primero])?.focus();
  }

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const locales = validar();
    if (Object.keys(locales).length) {
      setErrores(locales);
      setErrorGeneral(null);
      enfocar(locales);
      return;
    }
    enCurso.current = true;
    setEnviando(true);
    setErrorGeneral(null);
    try {
      const tarea = await escritorioService.convertirEnTarea(recordatorio.id, {
        title: valores.title.trim(),
        type: valores.type,
        frequency: valores.frequency,
        start_date: aMedianocheUTC(valores.start_date),
        end_date: aMedianocheUTC(valores.end_date),
        estimated_hours: Number(
          String(valores.estimated_hours).replace(",", "."),
        ),
      });
      onConvertido(tarea);
    } catch (err) {
      const e = errorDeEscritorio(err, "No se pudo crear la tarea.");
      if (e.estado === 409 || e.codigo === "conflict") {
        setErrorGeneral(`${e.mensaje} No se creó otra: búsquela en Tareas.`);
      } else {
        if (Object.keys(e.campos).length) {
          setErrores(e.campos);
          enfocar(e.campos);
        }
        setErrorGeneral(e.mensaje);
      }
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  return (
    <Ventana
      titulo="Convertir en tarea"
      subtitulo="La tarea queda asignada a usted, en el módulo Tareas."
      onCerrar={onCerrar}
      bloqueada={enviando}
      pie={
        <>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onCerrar}
            disabled={enviando}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form={ids.formulario}
            className="btn btn-primary"
            disabled={enviando}
          >
            {enviando ? (
              <>
                <span
                  className="spinner-border spinner-border-sm"
                  aria-hidden="true"
                />{" "}
                Creando…
              </>
            ) : (
              <>
                <Icon name="kanban" /> Crear tarea
              </>
            )}
          </button>
        </>
      }
    >
      <form
        id={ids.formulario}
        className="ed-formulario"
        onSubmit={enviar}
        noValidate
        aria-busy={enviando}
      >
        <LeyendaObligatorios />
        {errorGeneral && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            <span>{errorGeneral}</span>
          </div>
        )}
        <Campo
          id={ids.title}
          etiqueta="Título de la tarea"
          error={errores.title}
          ayuda="Si lo deja vacío, se usa el del recordatorio."
        >
          <input
            type="text"
            data-autofocus
            className="form-control"
            maxLength={255}
            value={valores.title}
            onChange={(e) => cambiar("title", e.target.value)}
          />
        </Campo>
        <div className="ed-formulario__fila">
          <Campo id={ids.type} etiqueta="Tipo" error={errores.type}>
            <select
              className="form-select"
              value={valores.type}
              onChange={(e) => cambiar("type", e.target.value)}
            >
              {Object.entries(TIPO).map(([id, texto]) => (
                <option key={id} value={id}>
                  {texto}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            id={ids.frequency}
            etiqueta="Frecuencia"
            error={errores.frequency}
          >
            <select
              className="form-select"
              value={valores.frequency}
              onChange={(e) => cambiar("frequency", e.target.value)}
            >
              {FRECUENCIAS.map((f) => (
                <option key={f} value={f}>
                  {FRECUENCIA[f]}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <div className="ed-formulario__fila">
          <Campo
            id={ids.start_date}
            etiqueta="Inicio"
            obligatorio
            error={errores.start_date}
          >
            <input
              type="date"
              className="form-control"
              value={valores.start_date}
              onChange={(e) => cambiar("start_date", e.target.value)}
            />
          </Campo>
          <Campo
            id={ids.end_date}
            etiqueta="Fin"
            obligatorio
            error={errores.end_date}
          >
            <input
              type="date"
              className="form-control"
              min={valores.start_date || undefined}
              value={valores.end_date}
              onChange={(e) => cambiar("end_date", e.target.value)}
            />
          </Campo>
        </div>
        <Campo
          id={ids.estimated_hours}
          etiqueta="Horas estimadas"
          obligatorio
          error={errores.estimated_hours}
          ayuda="Por ejemplo 1,5 para una hora y media."
        >
          <input
            type="text"
            inputMode="decimal"
            className="form-control ed-horas"
            value={valores.estimated_hours}
            onChange={(e) => cambiar("estimated_hours", e.target.value)}
          />
        </Campo>
      </form>
    </Ventana>
  );
}
