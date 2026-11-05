/*
 * Las acciones de una tarea, iguales en el Kanban, la Tabla y Equipo, para
 * el menú «Más acciones» (⋯). «Mover a…» es la alternativa sin arrastrar del
 * Kanban (WCAG 2.5.7); va al final, para que el foco inicial del menú no
 * quede sobre una acción que cambia la tarea. Lo que se ofrece sigue las reglas del servidor
 * (estado y color, solo la persona responsable; eliminar, quien la creó, su
 * líder o quien administra); el servidor las vuelve a aplicar.
 */
import { ESTADO, ESTADOS } from "./tareasComunes";

/**
 * @param {object} tarea
 * @param {object} contexto `{ usuarioId, administra, valida }`
 * @param {object} h manejadores: `actividades, retroactiva, comentarios,
 *   editar, color, mover, eliminar` (los ausentes no se ofrecen)
 */
export function accionesDeTarea(tarea, contexto, h) {
  const { usuarioId, administra, valida } = contexto;
  const esResponsable = tarea.assigned_to?.id === usuarioId;
  const creo = tarea.created_by?.id === usuarioId;
  const puedeEliminar =
    creo || administra || (valida && tarea.assigned_to?.id !== usuarioId);
  return [
    h.actividades && {
      texto: esResponsable ? "Registrar horas" : "Ver actividades",
      onClick: () => h.actividades(tarea),
    },
    esResponsable &&
      tarea.type === "SEGUIMIENTO" &&
      h.retroactiva && {
        texto: "Registro retroactivo",
        onClick: () => h.retroactiva(tarea),
      },
    h.comentarios && {
      texto: `Comentarios (${tarea.comment_count ?? 0})`,
      onClick: () => h.comentarios(tarea),
    },
    h.editar && { texto: "Editar", onClick: () => h.editar(tarea) },
    esResponsable &&
      h.color && {
        texto: "Color de la tarjeta",
        onClick: () => h.color(tarea),
      },
    ...(esResponsable && h.mover
      ? ESTADOS.filter((e) => e !== tarea.status).map((e) => ({
          texto: `Mover a ${ESTADO[e]}`,
          onClick: () => h.mover(tarea, e),
        }))
      : []),
    puedeEliminar &&
      h.eliminar && {
        texto: "Eliminar",
        onClick: () => h.eliminar(tarea),
        peligro: true,
      },
  ];
}
