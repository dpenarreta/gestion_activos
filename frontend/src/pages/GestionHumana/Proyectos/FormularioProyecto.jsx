/*
 * Crear o editar un proyecto (`CreateProjectModal` de Nexo; la edición es
 * nueva: en Nexo solo se cambiaban el estado y las observaciones). A quién se
 * puede elegir lo dice el servidor (`projects/members/`: activos en la
 * empresa y con acceso al módulo) y lo vuelve a revisar al guardar. Al
 * editar se envía solo lo que cambió.
 */
import { useMemo, useRef, useState } from "react";

import {
  errorDeProyectos,
  proyectosGhService,
} from "../../../api/proyectosGhService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { AnuncioDeResultados } from "../../../components/common/AnuncioDeResultados/AnuncioDeResultados";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { coincideBusqueda } from "../../../utils/busqueda";
import { ErrorEnLinea } from "../comunes";
import { PreviaHoras } from "../Tareas/Indicadores";
import {
  AYUDA_HORAS,
  HORAS_INVALIDAS,
  PRIORIDAD,
  PRIORIDADES,
  aMedianocheUTC,
  diaUTC,
  horasATexto,
  horasValidas,
  textoAHoras,
} from "../Tareas/tareasComunes";
import { useMiembros } from "./ContextoProyectos";
import {
  AYUDA_TIEMPO_OBJETIVO,
  ESTADO_PROYECTO,
  ESTADOS_INICIALES,
  ESTADOS_PROYECTO,
  etiquetasDeTexto,
  nombreDe,
  rolDe,
} from "./proyectosComunes";

function iniciales(proyecto, usuarioId) {
  return {
    name: proyecto?.name ?? "",
    description: proyecto?.description ?? "",
    responsible: String(proyecto?.responsible?.id ?? usuarioId ?? ""),
    area: proyecto?.area ?? "",
    start_date: proyecto ? diaUTC(proyecto.start_date) : "",
    target_date: proyecto ? diaUTC(proyecto.target_date) : "",
    status: proyecto?.status ?? "PENDIENTE",
    priority: proyecto?.priority ?? "MEDIA",
    target_time_hours: proyecto ? horasATexto(proyecto.target_time_hours) : "",
    tags: (proyecto?.tags ?? []).join(", "),
    observations: proyecto?.observations ?? "",
  };
}

export function FormularioProyecto({
  proyecto = null,
  usuarioId,
  onCerrar,
  onGuardado,
}) {
  const editando = Boolean(proyecto);
  const { miembros, errorMiembros, recargarMiembros } = useMiembros();
  const [valores, setValores] = useState(() => iniciales(proyecto, usuarioId));
  const [participantes, setParticipantes] = useState([]);
  const [filtro, setFiltro] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  const panel = useRef(null);

  const cambiar = (campo) => (evento) =>
    setValores((v) => ({ ...v, [campo]: evento.target.value }));

  // El responsable actual se conserva como opción aunque ya no esté entre
  // los elegibles (para no cambiarlo sin querer al editar).
  const opciones = useMemo(() => {
    const lista = [...(miembros ?? [])];
    if (
      proyecto?.responsible &&
      !lista.some((m) => m.id === proyecto.responsible.id)
    ) {
      lista.unshift(proyecto.responsible);
    }
    return lista.sort((a, b) => nombreDe(a).localeCompare(nombreDe(b), "es"));
  }, [miembros, proyecto]);

  // En cada tecla, sin distinguir tildes ni mayúsculas y cada palabra en
  // cualquier orden (búsqueda en vivo, 06/11/2026).
  const filtrados = opciones.filter((m) =>
    coincideBusqueda(filtro, nombreDe(m)),
  );

  function validar() {
    const e = {};
    if (!valores.name.trim()) e.name = "Escriba el nombre del proyecto.";
    if (!valores.responsible) e.responsible = "Elija el responsable principal.";
    if (!valores.start_date) e.start_date = "Elija la fecha de inicio.";
    if (!valores.target_date) e.target_date = "Elija la fecha objetivo.";
    if (
      valores.start_date &&
      valores.target_date &&
      valores.target_date < valores.start_date
    ) {
      e.target_date = "Debe ser igual o posterior a la fecha de inicio.";
    }
    if (!valores.target_time_hours.trim()) {
      e.target_time_hours = "Indique el tiempo objetivo.";
    } else if (!horasValidas(valores.target_time_hours)) {
      e.target_time_hours = HORAS_INVALIDAS;
    } else if (textoAHoras(valores.target_time_hours) <= 0) {
      e.target_time_hours = "Debe ser mayor que cero.";
    }
    return e;
  }

  function cuerpo() {
    const completo = {
      name: valores.name.trim(),
      description: valores.description.trim(),
      responsible: Number(valores.responsible),
      area: valores.area.trim(),
      start_date: aMedianocheUTC(valores.start_date),
      target_date: aMedianocheUTC(valores.target_date),
      status: valores.status,
      priority: valores.priority,
      target_time_hours: textoAHoras(valores.target_time_hours),
      tags: etiquetasDeTexto(valores.tags),
      observations: valores.observations.trim(),
    };
    if (!editando) return { ...completo, participant_ids: participantes };
    const original = iniciales(proyecto, usuarioId);
    const cambios = {};
    for (const campo of [
      "name",
      "description",
      "area",
      "status",
      "priority",
      "observations",
    ]) {
      if (valores[campo].trim() !== original[campo].trim())
        cambios[campo] = completo[campo];
    }
    if (valores.responsible !== original.responsible)
      cambios.responsible = completo.responsible;
    if (valores.start_date !== original.start_date)
      cambios.start_date = completo.start_date;
    if (valores.target_date !== original.target_date)
      cambios.target_date = completo.target_date;
    if (valores.target_time_hours !== original.target_time_hours)
      cambios.target_time_hours = completo.target_time_hours;
    if (
      etiquetasDeTexto(valores.tags).join("|") !==
      etiquetasDeTexto(original.tags).join("|")
    )
      cambios.tags = completo.tags;
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
      const guardado = editando
        ? await proyectosGhService.actualizar(proyecto.id, datos)
        : await proyectosGhService.crear(datos);
      onGuardado(guardado);
    } catch (err) {
      const fallo = errorDeProyectos(err, "No se pudo guardar el proyecto.");
      setErrores(fallo.campos);
      setError(fallo.mensaje);
      enfocarPrimerError(panel.current);
      setGuardando(false);
      enCurso.current = false;
    }
  }

  const alternar = (id) =>
    setParticipantes((lista) =>
      lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id],
    );

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo={editando ? "Editar proyecto" : "Nuevo proyecto"}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar={editando ? "Guardar cambios" : "Crear proyecto"}
      isSaving={guardando}
    >
      <div ref={panel}>
        <LeyendaObligatorios />
        <ErrorEnLinea mensaje={error} className="mt-2" />
        <Campo
          id="gp-form-nombre"
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
        <Campo
          id="gp-form-descripcion"
          etiqueta="Descripción"
          error={errores.description}
          className="mt-3"
        >
          <textarea
            className="form-control"
            rows={2}
            maxLength={5000}
            value={valores.description}
            onChange={cambiar("description")}
          />
        </Campo>

        <div className="gt-form-grid mt-3">
          <Campo
            id="gp-form-responsable"
            etiqueta="Responsable principal"
            obligatorio
            error={errores.responsible}
          >
            <select
              className="form-select"
              value={valores.responsible}
              onChange={cambiar("responsible")}
              disabled={miembros === null && !errorMiembros}
            >
              {miembros === null && !errorMiembros && (
                <option value={valores.responsible}>Cargando…</option>
              )}
              {!opciones.some((m) => String(m.id) === valores.responsible) &&
                miembros !== null && (
                  <option value="">Elija una persona</option>
                )}
              {opciones.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.id === usuarioId ? `${nombreDe(m)} (usted)` : nombreDe(m)}
                  {rolDe(m) ? ` · ${rolDe(m)}` : ""}
                </option>
              ))}
            </select>
          </Campo>
          <Campo id="gp-form-area" etiqueta="Área" error={errores.area}>
            <input
              className="form-control"
              maxLength={255}
              value={valores.area}
              onChange={cambiar("area")}
              placeholder="Ej.: Selección"
            />
          </Campo>
          <Campo
            id="gp-form-inicio"
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
            id="gp-form-objetivo-fecha"
            etiqueta="Fecha objetivo"
            obligatorio
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
          <Campo
            id="gp-form-estado"
            etiqueta={editando ? "Estado" : "Estado inicial"}
            error={errores.status}
          >
            <select
              className="form-select"
              value={valores.status}
              onChange={cambiar("status")}
            >
              {(editando ? ESTADOS_PROYECTO : ESTADOS_INICIALES).map((e) => (
                <option key={e} value={e}>
                  {ESTADO_PROYECTO[e]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            id="gp-form-prioridad"
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
          <div>
            <Campo
              id="gp-form-horas"
              etiqueta="Tiempo objetivo (HH.MM)"
              obligatorio
              error={errores.target_time_hours}
              ayuda={`${AYUDA_HORAS} ${AYUDA_TIEMPO_OBJETIVO}`}
            >
              <input
                className="form-control"
                inputMode="decimal"
                value={valores.target_time_hours}
                onChange={cambiar("target_time_hours")}
                placeholder="Ej.: 40.00"
              />
            </Campo>
            <PreviaHoras texto={valores.target_time_hours} />
          </div>
          <Campo
            id="gp-form-etiquetas"
            etiqueta="Etiquetas"
            error={errores.tags}
            ayuda="Separadas por coma. Ej.: sierra, kits, logística"
          >
            <input
              className="form-control"
              value={valores.tags}
              onChange={cambiar("tags")}
            />
          </Campo>
        </div>

        {!editando && (
          <fieldset className="mt-3">
            <legend className="form-label gt-legend">
              Participantes
              {participantes.length > 0 && ` (${participantes.length})`}
            </legend>
            {errorMiembros ? (
              <EstadoDeCarga
                error={errorMiembros}
                onReintentar={recargarMiembros}
              />
            ) : miembros === null ? (
              <EstadoDeCarga cargando />
            ) : opciones.length === 0 ? (
              <p className="mz-small mz-faint mb-0">
                No hay personas disponibles para agregar.
              </p>
            ) : (
              <>
                <label className="visually-hidden" htmlFor="gp-form-buscar">
                  Buscar participantes
                </label>
                <input
                  id="gp-form-buscar"
                  type="search"
                  className="form-control form-control-sm mb-2"
                  placeholder="Buscar por nombre"
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value)}
                  // Enter aquí filtra (ya lo hace solo); no debe guardar el
                  // proyecto a medio llenar.
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                />
                <AnuncioDeResultados
                  termino={filtro}
                  total={filtrados.length}
                />
                <ul className="gh-seleccion gh-desplazable">
                  {filtrados.map((m) => (
                    <li key={m.id}>
                      <label className="form-check">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={participantes.includes(m.id)}
                          onChange={() => alternar(m.id)}
                        />
                        <span className="form-check-label">
                          {nombreDe(m)}
                          {rolDe(m) && (
                            <span className="mz-faint"> · {rolDe(m)}</span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                  {filtrados.length === 0 && (
                    <li className="mz-small mz-faint">
                      Nadie coincide con «{filtro}».
                    </li>
                  )}
                </ul>
              </>
            )}
          </fieldset>
        )}

        <Campo
          id="gp-form-observaciones"
          etiqueta="Observaciones"
          error={errores.observations}
          className="mt-3"
        >
          <textarea
            className="form-control"
            rows={2}
            maxLength={5000}
            value={valores.observations}
            onChange={cambiar("observations")}
          />
        </Campo>
      </div>
    </ModalDialog>
  );
}
