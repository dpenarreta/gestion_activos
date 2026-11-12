import { Link } from "react-router-dom";

import { Icon } from "../../common/Icon/Icon";
import { hasActiveDescendant } from "./adminMenuTree";

/** Qué cuenta cada insignia, para el título y los lectores de pantalla:
 * `[título, con 1, con varios]` («1 reporte nuevo», «3 reportes nuevos»). */
export const TEXTOS = {
  atencion: [
    "Incumplidas o que vencen hoy",
    "que pide atención",
    "que piden atención",
  ],
  por_aprobar: [
    "Solicitudes de permiso que tiene por aprobar",
    "por aprobar",
    "por aprobar",
  ],
  proyectos_por_atender: [
    "Solicitudes de proyecto que tiene por atender",
    "por atender",
    "por atender",
  ],
  procesos_por_atender: [
    "Solicitudes de proceso que tiene por atender",
    "por atender",
    "por atender",
  ],
  sugerencias: [
    "Reportes nuevos sin revisar",
    "reporte nuevo",
    "reportes nuevos",
  ],
  notas_sin_leer: ["Notas sin leer", "nota sin leer", "notas sin leer"],
  onboarding: [
    "Materiales que le faltan aprobar",
    "material pendiente",
    "materiales pendientes",
  ],
  rol_por_confirmar: [
    "Su rol de pagos por aceptar o correcciones por confirmar",
    "pendiente de aceptar o confirmar",
    "pendientes de aceptar o confirmar",
  ],
  observaciones_rol: [
    "Observaciones a roles de pagos por atender",
    "observación por atender",
    "observaciones por atender",
  ],
  privacidad_vencidas: [
    "Solicitudes de datos personales vencidas",
    "solicitud vencida",
    "solicitudes vencidas",
  ],
};

/** Las insignias que avisan sin ser un incumplimiento (las notas sin leer
 * del Escritorio): van en el tono de información y no en el rojo de lo que
 * pide atención (auditoría UX/UI, 06/11/2026). */
const INFORMATIVAS = new Set(["notas_sin_leer"]);

export const claseDeInsignia = (tipo) =>
  INFORMATIVAS.has(tipo) ? "mz-badge mz-badge--info" : "mz-badge";

/** El texto oculto que dice qué cuenta el número, en singular o plural. */
export function sufijoDeInsignia(tipo, cantidad) {
  const [, uno, varios] = TEXTOS[tipo] ?? TEXTOS.atencion;
  return cantidad === 1 ? uno : varios;
}

/** Ítem hoja del Menú Administrativo (sin hijos): siempre navega. Con
 * `insignia`, un contador a la derecha: lo que esa pantalla tiene pendiente. */
export function AdminMenuItem({
  item,
  isCollapsed,
  currentPath,
  onNavigate,
  insignia,
  tipoInsignia = "atencion",
}) {
  const [titulo] = TEXTOS[tipoInsignia] ?? TEXTOS.atencion;
  const sufijo = sufijoDeInsignia(tipoInsignia, insignia);
  const isActive = hasActiveDescendant(item, currentPath);
  return (
    <li>
      <Link
        to={item.path || "#"}
        className={`mz-nav-item ${isActive ? "is-active" : ""}`}
        aria-current={isActive ? "page" : undefined}
        onClick={(event) => onNavigate(event, item.path)}
        title={isCollapsed ? item.name : undefined}
      >
        <Icon name={item.icon} />
        {!isCollapsed && <span className="mz-nav-label">{item.name}</span>}
        {/* Qué cuenta el número va en texto oculto y no en un aria-label:
            sobre un <span> sin rol el aria-label se ignora y se leía «Matriz
            3» sin decir qué era (auditoría UX/UI, fase 3, 28/10/2026). */}
        {insignia > 0 && (
          <span className={claseDeInsignia(tipoInsignia)} title={titulo}>
            {insignia}
            <span className="visually-hidden"> {sufijo}</span>
          </span>
        )}
      </Link>
    </li>
  );
}
