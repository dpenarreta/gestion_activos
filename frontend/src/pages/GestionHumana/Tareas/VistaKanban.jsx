/*
 * Kanban de sus tareas (`KanbanView` y `TaskCard` de Nexo): tres columnas
 * por estado; «Completada» empieza contraída. Con el mouse o el dedo se
 * arrastra la tarjeta a otra columna; sin arrastrar, el selector de estado
 * de la tarjeta o «Más acciones › Mover a…» hacen lo mismo (WCAG 2.5.7).
 * La tarjeta no se vuelve un botón arrastrable: dentro tiene sus propios
 * controles, y el teclado usa el menú.
 */
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useState } from "react";

import { Icon } from "../../../components/common/Icon/Icon";
import { MenuDeAcciones } from "../comunes";
import { BotonDeEstado, idFoco, useEnfocarTarea } from "./BotonDeEstado";
import { MarcaVencida, PillPrioridad } from "./Indicadores";
import { accionesDeTarea } from "./accionesDeTarea";
import {
  ESTADO,
  ESTADOS,
  FRECUENCIA,
  ICONO_ESTADO,
  TIPO,
  claseDeColor,
  fechaCorta,
  nombreDe,
  vencida,
} from "./tareasComunes";

function Tarjeta({
  tarea,
  contexto,
  acciones,
  onMover,
  onComentarios,
  onActividades,
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: tarea.id,
    disabled: tarea.assigned_to?.id !== contexto.usuarioId,
  });
  const esResponsable = tarea.assigned_to?.id === contexto.usuarioId;
  // Solo los atributos que no la convierten en botón: los controles internos
  // tienen que seguir siendo alcanzables con el teclado.
  const { "aria-describedby": describe } = attributes;
  return (
    <article
      ref={setNodeRef}
      className={`gt-tarjeta ${claseDeColor(tarea.color)}${isDragging ? " gt-tarjeta--arrastrando" : ""}`}
      aria-labelledby={idFoco(tarea.id)}
      aria-describedby={describe}
      {...listeners}
    >
      <div className="gt-tarjeta__cabeza">
        <h4 id={idFoco(tarea.id)} className="gt-tarjeta__titulo" tabIndex={-1}>
          {tarea.title}
        </h4>
        <MenuDeAcciones
          etiqueta={`Más acciones de «${tarea.title}»`}
          acciones={acciones}
        />
      </div>
      <div className="gt-tarjeta__marcas">
        <PillPrioridad prioridad={tarea.priority} />
        <span className="mz-pill mz-pill--neutral">
          {FRECUENCIA[tarea.frequency] ?? tarea.frequency}
        </span>
        <span className="mz-pill mz-pill--neutral">
          {tarea.type === "SEGUIMIENTO" && <Icon name="clock" />}
          {TIPO[tarea.type] ?? tarea.type}
        </span>
      </div>
      {!esResponsable && (
        <p className="mz-small mz-faint mb-1">
          Responsable: {nombreDe(tarea.assigned_to)}
        </p>
      )}
      {esResponsable && (
        <div className="gt-tarjeta__estado">
          <BotonDeEstado tarea={tarea} onMover={onMover} />
        </div>
      )}
      <div className="gt-tarjeta__pie">
        <span className={vencida(tarea) ? "gt-texto--bad" : "mz-faint"}>
          Vence {fechaCorta(tarea.end_date)}
        </span>
        {vencida(tarea) && <MarcaVencida />}
        <span className="gt-tarjeta__botones">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => onActividades(tarea)}
            aria-label={`Actividades de «${tarea.title}»`}
            title="Registro de actividades"
          >
            <Icon name="stopwatch" />
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => onComentarios(tarea)}
            aria-label={`Comentarios de «${tarea.title}»: ${tarea.comment_count ?? 0}${tarea.has_unread_comments ? ", hay nuevos" : ""}`}
            title="Comentarios"
          >
            <Icon name="chat-left-text" /> {tarea.comment_count ?? 0}
            {tarea.has_unread_comments && (
              <span className="gt-nuevo" aria-hidden="true">
                nuevos
              </span>
            )}
          </button>
        </span>
      </div>
    </article>
  );
}

function Columna({ estado, tareas, contraida, onContraer, onNueva, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: estado });
  const idLista = `gt-k-col-${estado}`;
  return (
    <section
      ref={setNodeRef}
      className={`gt-columna${isOver ? " gt-columna--destino" : ""}`}
      aria-labelledby={`${idLista}-titulo`}
    >
      <div className="gt-columna__cabeza">
        <h3 className="gt-columna__titulo">
          <button
            type="button"
            className="gt-columna__plegar"
            aria-expanded={!contraida}
            aria-controls={idLista}
            onClick={onContraer}
          >
            <Icon name={contraida ? "chevron-right" : "chevron-down"} />
            <Icon name={ICONO_ESTADO[estado]} />
            <span id={`${idLista}-titulo`}>{ESTADO[estado]}</span>
            <span className="gt-cuenta">
              {tareas.length}
              <span className="visually-hidden"> tareas</span>
            </span>
          </button>
        </h3>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          aria-label={`Nueva tarea en ${ESTADO[estado]}`}
          title="Nueva tarea"
          onClick={() => onNueva(estado)}
        >
          <Icon name="plus-lg" />
        </button>
      </div>
      <div id={idLista} hidden={contraida} className="gt-columna__lista">
        {tareas.length === 0 ? (
          <p className="mz-empty mb-0">Sin tareas.</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

export function VistaKanban({ tareas, contexto, manejadores, onNueva, foco }) {
  const [contraidas, setContraidas] = useState({ COMPLETADA: true });
  useEnfocarTarea(foco, tareas, (estado) =>
    setContraidas((c) => ({ ...c, [estado]: false })),
  );
  const sensores = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 6 },
    }),
  );

  function soltar({ active, over }) {
    if (!over) return;
    const tarea = tareas.find((t) => t.id === active.id);
    if (tarea && tarea.status !== over.id) manejadores.mover(tarea, over.id);
  }

  return (
    <DndContext
      sensors={sensores}
      onDragEnd={soltar}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Para cambiar el estado sin arrastrar, use el botón de estado de la tarjeta o «Más acciones».",
        },
      }}
    >
      <div className="gt-kanban">
        {ESTADOS.map((estado) => {
          const lista = tareas.filter((t) => t.status === estado);
          return (
            <Columna
              key={estado}
              estado={estado}
              tareas={lista}
              contraida={Boolean(contraidas[estado])}
              onContraer={() =>
                setContraidas((c) => ({ ...c, [estado]: !c[estado] }))
              }
              onNueva={onNueva}
            >
              {lista.map((t) => (
                <Tarjeta
                  key={t.id}
                  tarea={t}
                  contexto={contexto}
                  acciones={accionesDeTarea(t, contexto, manejadores)}
                  onMover={manejadores.mover}
                  onComentarios={manejadores.comentarios}
                  onActividades={manejadores.actividades}
                />
              ))}
            </Columna>
          );
        })}
      </div>
    </DndContext>
  );
}
