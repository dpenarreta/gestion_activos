import { Link } from "react-router-dom";

import { Icon } from "../../common/Icon/Icon";
import { hasActiveDescendant } from "./adminMenuTree";

/** Qué cuenta cada insignia, para el título y los lectores de pantalla. */
const TEXTOS = {
  atencion: ["Incumplidas o que vencen hoy", "que piden atención"],
  por_aprobar: ["Solicitudes que tiene por aprobar", "por aprobar"],
  sugerencias: ["Reportes nuevos sin revisar", "reportes nuevos"],
  onboarding: ["Materiales que le faltan aprobar", "materiales pendientes"],
  rol_por_confirmar: [
    "Correcciones a su rol de pagos por confirmar",
    "correcciones por confirmar",
  ],
  observaciones_rol: [
    "Observaciones a roles de pagos por atender",
    "observaciones por atender",
  ],
};

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
  const [titulo, sufijo] = TEXTOS[tipoInsignia] ?? TEXTOS.atencion;
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
          <span className="mz-badge" title={titulo}>
            {insignia}
            <span className="visually-hidden"> {sufijo}</span>
          </span>
        )}
      </Link>
    </li>
  );
}
