/*
 * Crear o editar una tarea (`TaskFormModal` de Nexo). A quién se puede
 * asignar lo decide el servidor (`assignable-users/`: ella misma y su equipo
 * según el organigrama; quien administra, cualquiera de la empresa) y lo
 * vuelve a revisar al guardar. Estado, color y horas reales son solo del
 * responsable: a quien edita una tarea ajena no se le ofrece el estado.
 */
import { useEffect, useRef, useState } from "react";

import { errorDeTareas, tareasService } from "../../../api/tareasService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { ErrorEnLinea } from "../comunes";
import { PreviaHoras } from "./Indicadores";
import {
  AYUDA_HORAS,
  AYUDA_TIEMPO_OBJETIVO,
  ESTADO,
  ESTADOS,
  FRECUENCIA,
  FRECUENCIAS,
  HORAS_INVALIDAS,
  PRIORIDAD,
  PRIORIDADES,
  TIPO,
  aMedianocheUTC,
  diaUTC,
  horasATexto,
  horasValidas,
  hoy,
  nombreDe,
  rolLegible,
  textoAHoras,
} from "./tareasComunes";

export function FormularioTarea({
  tarea = null,
  estadoInicial = "PENDIENTE",
  asignadoInicial,
  usuarioId,
  onCerrar,
  onGuardada,
}) {
  const editando = Boolean(tarea);
  const esResponsable = !editando || tarea.assigned_to?.id === usuarioId;
  const [valores, setValores] = useState(() => ({
    title: tarea?.title ?? "",
    description: tarea?.description ?? "",
    type: tarea?.type ?? "FIJA",
    status: tarea?.status ?? estadoInicial,
    priority: tarea?.priority ?? "MEDIA",
    frequency: tarea?.frequency ?? "MENSUAL",
    start_date: tarea ? diaUTC(tarea.start_date) : hoy(),
    end_date: tarea ? diaUTC(tarea.end_date) : "",
    estimated_hours: tarea ? horasATexto(tarea.estimated_hours) : "",
    assigned_to: String(
      tarea?.assigned_to?.id ?? asignadoInicial ?? usuarioId ?? "",
    ),
  }));
  const [personas, setPersonas] = useState(null);
  const [errorPersonas, setErrorPersonas] = useState(null);
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  const panel = useRef(null);

  const cargarPersonas = () => {
    setErrorPersonas(null);
    tareasService
      .asignables()
      .then((lista) => setPersonas(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setErrorPersonas(
          errorDeTareas(err, "No se pudo cargar a quién puede asignar.")
            .mensaje,
        ),
      );
  };

  useEffect(() => {
    cargarPersonas();
  }, []);

  const cambiar = (campo) => (evento) =>
    setValores((v) => ({ ...v, [campo]: evento.target.value }));

  function validar() {
    const e = {};
    if (!valores.title.trim()) e.title = "Escriba el título de la tarea.";
    if (!valores.start_date) e.start_date = "Elija la fecha de inicio.";
    if (!valores.end_date) e.end_date = "Elija la fecha de fin.";
    if (
      valores.start_date &&
      valores.end_date &&
      valores.end_date < valores.start_date
    ) {
      e.end_date = "Debe ser igual o posterior a la fecha de inicio.";
    }
    if (!valores.estimated_hours.trim()) {
      e.estimated_hours = "Indique el tiempo objetivo.";
    } else if (!horasValidas(valores.estimated_hours)) {
      e.estimated_hours = HORAS_INVALIDAS;
    }
    if (!valores.assigned_to) e.assigned_to = "Elija a quién se asigna.";
    return e;
  }

  /** Lo que se envía: todo al crear; al editar, solo lo que cambió (el estado
   * es del responsable, y mandarlo sin cambios igual se rechazaría). */
  function cuerpo() {
    const completo = {
      title: valores.title.trim(),
      description: valores.description.trim(),
      type: valores.type,
      priority: valores.priority,
      frequency: valores.frequency,
      start_date: aMedianocheUTC(valores.start_date),
      end_date: aMedianocheUTC(valores.end_date),
      estimated_hours: textoAHoras(valores.estimated_hours),
      assigned_to: Number(valores.assigned_to),
    };
    if (!editando) return { ...completo, status: valores.status };
    const cambios = {};
    if (completo.title !== tarea.title) cambios.title = completo.title;
    if (completo.description !== (tarea.description ?? ""))
      cambios.description = completo.description;
    if (completo.type !== tarea.type) cambios.type = completo.type;
    if (completo.priority !== tarea.priority)
      cambios.priority = completo.priority;
    if (completo.frequency !== tarea.frequency)
      cambios.frequency = completo.frequency;
    if (valores.start_date !== diaUTC(tarea.start_date))
      cambios.start_date = completo.start_date;
    if (valores.end_date !== diaUTC(tarea.end_date))
      cambios.end_date = completo.end_date;
    if (valores.estimated_hours !== horasATexto(tarea.estimated_hours))
      cambios.estimated_hours = completo.estimated_hours;
    if (completo.assigned_to !== tarea.assigned_to?.id)
      cambios.assigned_to = completo.assigned_to;
    if (esResponsable && valores.status !== tarea.status)
      cambios.status = valores.status;
    return cambios;
  }

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const e = validar();
    setErrores(e);
    setError(null);
    if (Object.keys(e).length) {
      enfocarPrimerError(panel.current);
      return;
    }
    const datos = cuerpo();
    if (editando && !Object.keys(datos).length) {
      onCerrar();
      return;
    }
    // Un doble clic llega antes de que se pinte el botón deshabilitado.
    enCurso.current = true;
    setGuardando(true);
    try {
      const guardada = editando
        ? await tareasService.actualizar(tarea.id, datos)
        : await tareasService.crear(datos);
      onGuardada(guardada, editando ? "Tarea actualizada." : "Tarea creada.");
    } catch (err) {
      const fallo = errorDeTareas(err, "No se pudo guardar la tarea.");
      setErrores(fallo.campos);
      setError(fallo.mensaje);
      enfocarPrimerError(panel.current);
      setGuardando(false);
      enCurso.current = false;
    }
  }

  // Si la persona asignada no está entre las asignables (tarea de alguien que
  // ya no es de su equipo), se conserva como opción para no cambiarla sin
  // querer.
  const opciones = [...(personas ?? [])];
  if (
    tarea?.assigned_to &&
    !opciones.some((p) => p.id === tarea.assigned_to.id)
  ) {
    opciones.unshift({
      id: tarea.assigned_to.id,
      name: nombreDe(tarea.assigned_to),
      role: tarea.assigned_to.roles?.[0]?.name ?? "",
    });
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo={editando ? "Editar tarea" : "Nueva tarea"}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar={editando ? "Guardar cambios" : "Crear tarea"}
      isSaving={guardando}
    >
      <div ref={panel}>
        <LeyendaObligatorios />
        <ErrorEnLinea mensaje={error} className="mt-2" />
        <Campo
          id="gt-form-titulo"
          etiqueta="Título"
          obligatorio
          error={errores.title}
          className="mt-3"
        >
          <input
            className="form-control"
            maxLength={255}
            value={valores.title}
            onChange={cambiar("title")}
            data-autofocus
          />
        </Campo>
        <Campo
          id="gt-form-descripcion"
          etiqueta="Descripción"
          error={errores.description}
          className="mt-3"
        >
          <textarea
            className="form-control"
            rows={3}
            maxLength={5000}
            value={valores.description}
            onChange={cambiar("description")}
          />
        </Campo>

        <fieldset className="mt-3">
          <legend className="form-label gt-legend">Clasificación</legend>
          <div className="gt-opciones">
            {Object.entries(TIPO).map(([valor, texto]) => (
              <label key={valor} className="gt-opcion">
                <input
                  type="radio"
                  name="gt-form-tipo"
                  value={valor}
                  checked={valores.type === valor}
                  onChange={cambiar("type")}
                />
                <span className="gt-opcion__texto">
                  {texto}
                  <span className="mz-small mz-faint d-block">
                    {valor === "FIJA"
                      ? "Hasta 2 registros de horas."
                      : "Registros con horario y registro retroactivo."}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="gt-form-grid mt-3">
          <Campo
            id="gt-form-estado"
            etiqueta="Estado"
            error={errores.status}
            ayuda={
              esResponsable
                ? undefined
                : "Solo la persona responsable cambia el estado."
            }
          >
            <select
              className="form-select"
              value={valores.status}
              onChange={cambiar("status")}
              disabled={!esResponsable}
            >
              {ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {ESTADO[e]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            id="gt-form-prioridad"
            etiqueta="Prioridad"
            obligatorio
            error={errores.priority}
          >
            <select
              className="form-select"
              value={valores.priority}
              onChange={cambiar("priority")}
            >
              {PRIORIDADES.map((p) => (
                <option key={p} value={p}>
                  {PRIORIDAD[p]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            id="gt-form-frecuencia"
            etiqueta="Frecuencia"
            obligatorio
            error={errores.frequency}
          >
            <select
              className="form-select"
              value={valores.frequency}
              onChange={cambiar("frequency")}
            >
              {FRECUENCIAS.map((f) => (
                <option key={f} value={f}>
                  {FRECUENCIA[f]}
                </option>
              ))}
            </select>
          </Campo>
          <div>
            <Campo
              id="gt-form-objetivo"
              etiqueta="Tiempo objetivo (HH.MM)"
              obligatorio
              error={errores.estimated_hours}
              ayuda={`${AYUDA_HORAS} ${AYUDA_TIEMPO_OBJETIVO}`}
            >
              <input
                className="form-control"
                inputMode="decimal"
                value={valores.estimated_hours}
                onChange={cambiar("estimated_hours")}
                placeholder="Ej.: 6.30"
              />
            </Campo>
            <PreviaHoras texto={valores.estimated_hours} />
          </div>
          <Campo
            id="gt-form-inicio"
            etiqueta="Fecha de inicio"
            obligatorio
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
            id="gt-form-fin"
            etiqueta="Fecha de fin"
            obligatorio
            error={errores.end_date}
            ayuda={
              !editando
                ? "Queda pendiente de validación del líder."
                : tarea.end_date_approval_status !== "PENDIENTE"
                  ? "Si la cambia, vuelve a quedar pendiente de validación del líder."
                  : undefined
            }
          >
            <input
              type="date"
              className="form-control"
              value={valores.end_date}
              min={valores.start_date || undefined}
              onChange={cambiar("end_date")}
            />
          </Campo>
        </div>

        <Campo
          id="gt-form-asignado"
          etiqueta="Asignada a"
          obligatorio
          error={errores.assigned_to}
          className="mt-3"
        >
          <select
            className="form-select"
            value={valores.assigned_to}
            onChange={cambiar("assigned_to")}
            disabled={personas === null && !errorPersonas}
          >
            {personas === null && !errorPersonas && (
              <option value={valores.assigned_to}>Cargando…</option>
            )}
            {opciones.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.id === usuarioId ? `${p.name} (usted)` : p.name}
                {p.role ? ` · ${rolLegible(p.role)}` : ""}
              </option>
            ))}
          </select>
        </Campo>
        {errorPersonas && (
          <EstadoDeCarga error={errorPersonas} onReintentar={cargarPersonas} />
        )}
      </div>
    </ModalDialog>
  );
}
