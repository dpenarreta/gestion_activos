/*
 * El estado de una tarea como botón que abre «Mover a…» (la alternativa sin
 * arrastrar del Kanban, WCAG 2.5.7). Un `<select>` movía la tarea en cada
 * `onChange`: con el teclado, cada flecha la cambiaba de columna (auditoría
 * UX/UI de Tareas, 04/11/2026). Aquí solo se mueve al elegir una opción.
 */
import { useEffect } from "react";

import { Icon } from "../../../components/common/Icon/Icon";
import { MenuDeAcciones } from "../comunes";
import { ESTADO, ESTADOS, ICONO_ESTADO } from "./tareasComunes";

export function BotonDeEstado({ tarea, onMover }) {
  return (
    <MenuDeAcciones
      etiqueta={`Estado de «${tarea.title}»: ${ESTADO[tarea.status]}. Cambiar estado`}
      contenido={
        <>
          <Icon name={ICONO_ESTADO[tarea.status]} />
          {ESTADO[tarea.status]}
          <Icon name="chevron-down" />
        </>
      }
      acciones={ESTADOS.filter((e) => e !== tarea.status).map((e) => ({
        texto: `Mover a ${ESTADO[e]}`,
        onClick: () => onMover(tarea, e),
      }))}
    />
  );
}

/** El id del título de una tarea en el Kanban o la Tabla (recibe el foco). */
export const idFoco = (id) => `gt-foco-tarea-${id}`;

/**
 * Después de mover una tarea, el foco va a su título en la nueva columna o
 * sección (que se despliega si estaba contraída): si no, quedaba en
 * `<body>` y quien usa teclado perdía su lugar.
 *
 * `foco`: `{ id, vez }`, nuevo en cada movimiento; `expandir(estado)`.
 */
export function useEnfocarTarea(foco, tareas, expandir) {
  useEffect(() => {
    if (!foco) return undefined;
    const tarea = tareas.find((t) => t.id === foco.id);
    if (!tarea) return undefined;
    expandir?.(tarea.status);
    const reloj = setTimeout(
      () => document.getElementById(idFoco(foco.id))?.focus(),
      0,
    );
    return () => clearTimeout(reloj);
    // Solo con cada movimiento nuevo (`foco` cambia de identidad).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foco]);
}
