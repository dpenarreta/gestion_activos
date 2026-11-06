/*
 * «Nuevo recordatorio» y su edición (`NewReminderModal` de Nexo): título
 * (hasta 150 caracteres), cuándo, descripción, prioridad y repetición. Al
 * editar solo se manda lo que cambió. El servidor vuelve a validar y su
 * motivo se muestra bajo el campo.
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
import { aCampoLocal, deCampoLocal } from "../Reuniones/reunionesComunes";
import { Ventana } from "../Tareas/Ventanas";
import { useEscritorio } from "./ContextoEscritorio";
import { DESCRIPCION_MAX, TITULO_MAX } from "./escritorioComunes";

const ORDEN = ["title", "due_at", "description", "priority", "repeat"];

/** Mañana a las 9:00: un valor razonable para empezar. */
function mananaALasNueve() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return aCampoLocal(d.toISOString());
}

export function FormularioRecordatorio({
  recordatorio = null,
  onCerrar,
  onGuardado,
}) {
  const { prioridadesRecordatorio, repeticiones } = useEscritorio();
  const editando = Boolean(recordatorio);
  const base = useId();
  const ids = {
    title: `${base}-titulo`,
    due_at: `${base}-vence`,
    description: `${base}-descripcion`,
    priority: `${base}-prioridad`,
    repeat: `${base}-repeticion`,
    formulario: `${base}-formulario`,
  };
  const [valores, setValores] = useState(() => ({
    title: recordatorio?.title ?? "",
    due_at: recordatorio ? aCampoLocal(recordatorio.due_at) : mananaALasNueve(),
    description: recordatorio?.description ?? "",
    priority: recordatorio?.priority ?? "MEDIA",
    repeat: recordatorio?.repeat ?? "UNA_VEZ",
  }));
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
    if (!valores.title.trim()) e.title = "Escriba qué quiere recordar.";
    if (!valores.due_at || !deCampoLocal(valores.due_at))
      e.due_at = "Elija la fecha y la hora del recordatorio.";
    return e;
  }

  function enfocar(campos) {
    const primero = ORDEN.find((c) => campos[c]);
    if (primero) document.getElementById(ids[primero])?.focus();
  }

  function cuerpo() {
    const completo = {
      title: valores.title.trim(),
      due_at: deCampoLocal(valores.due_at),
      description: valores.description.trim(),
      priority: valores.priority,
      repeat: valores.repeat,
    };
    if (!editando) return completo;
    const antes = {
      title: recordatorio.title,
      due_at: new Date(recordatorio.due_at).toISOString(),
      description: recordatorio.description ?? "",
      priority: recordatorio.priority,
      repeat: recordatorio.repeat,
    };
    return Object.fromEntries(
      Object.entries(completo).filter(([c, v]) => v !== antes[c]),
    );
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
    const datos = cuerpo();
    if (editando && Object.keys(datos).length === 0) {
      onCerrar();
      return;
    }
    enCurso.current = true;
    setEnviando(true);
    setErrorGeneral(null);
    try {
      const guardado = editando
        ? await escritorioService.editarRecordatorio(recordatorio.id, datos)
        : await escritorioService.crearRecordatorio(datos);
      onGuardado(guardado);
    } catch (err) {
      const e = errorDeEscritorio(err, "No se pudo guardar el recordatorio.");
      if (Object.keys(e.campos).length) {
        setErrores(e.campos);
        enfocar(e.campos);
      }
      setErrorGeneral(e.mensaje);
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  return (
    <Ventana
      titulo={editando ? "Editar el recordatorio" : "Nuevo recordatorio"}
      subtitulo="Solo usted lo ve. Al vencer, le llega el aviso en la campana."
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
                Guardando…
              </>
            ) : (
              <>
                <Icon name="alarm" />{" "}
                {editando ? "Guardar cambios" : "Crear recordatorio"}
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
          etiqueta="Título"
          obligatorio
          error={errores.title}
          ayuda={`${valores.title.length} de ${TITULO_MAX} caracteres.`}
        >
          <input
            type="text"
            data-autofocus
            className="form-control"
            maxLength={TITULO_MAX}
            value={valores.title}
            placeholder="Por ejemplo: Enviar el reporte de asistencia"
            onChange={(e) => cambiar("title", e.target.value)}
          />
        </Campo>
        <Campo
          id={ids.due_at}
          etiqueta="Fecha y hora"
          obligatorio
          error={errores.due_at}
        >
          <input
            type="datetime-local"
            className="form-control"
            value={valores.due_at}
            onChange={(e) => cambiar("due_at", e.target.value)}
          />
        </Campo>
        <Campo
          id={ids.description}
          etiqueta="Descripción (opcional)"
          error={errores.description}
          ayuda={`${valores.description.length} de ${DESCRIPCION_MAX} caracteres.`}
        >
          <textarea
            className="form-control"
            rows={3}
            maxLength={DESCRIPCION_MAX}
            value={valores.description}
            onChange={(e) => cambiar("description", e.target.value)}
          />
        </Campo>
        <div className="ed-formulario__fila">
          <Campo
            id={ids.priority}
            etiqueta="Prioridad"
            error={errores.priority}
          >
            <select
              className="form-select"
              value={valores.priority}
              onChange={(e) => cambiar("priority", e.target.value)}
            >
              {prioridadesRecordatorio.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.texto}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            id={ids.repeat}
            etiqueta="Repetición"
            error={errores.repeat}
            ayuda="Al completarlo, se crea solo el siguiente."
          >
            <select
              className="form-select"
              value={valores.repeat}
              onChange={(e) => cambiar("repeat", e.target.value)}
            >
              {repeticiones.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.texto}
                </option>
              ))}
            </select>
          </Campo>
        </div>
      </form>
    </Ventana>
  );
}
