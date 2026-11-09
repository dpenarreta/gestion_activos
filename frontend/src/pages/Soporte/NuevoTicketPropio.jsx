import { Link } from "react-router-dom";

import { useAuth } from "../../hooks/useAuth";
import { usePermission } from "../../hooks/usePermission";
import {
  PERMISO_MESA_MIS_TICKETS,
  PERMISOS_SOPORTE,
} from "../../modulos/permisosSoporte";
import { NuevoTicket } from "../Ayuda/NuevoTicket";
import "./Soporte.css";

/** Dónde se sigue un ticket propio creado desde la Mesa de ayuda. */
const MIS_SOLICITUDES = "/admin/soporte/bandeja?vista=creados";

/** Tras crearlo, a «Mis tickets» de la bandeja: no se sale del módulo. */
function aMisSolicitudes() {
  return { to: MIS_SOLICITUDES, texto: "Verlo en Mis tickets" };
}

/** Sin «Ver sus tickets en la Mesa de ayuda», al detalle en «Soporte TI», que
 * no pide permiso. */
function aSuDetalle(creado) {
  return { to: `/admin/ayuda/tickets/${creado.id}`, texto: "Ver mi ticket" };
}

/**
 * Mesa de ayuda → «Pedir ayuda a su nombre» (09/11/2026): un ticket a su nombre desde
 * dentro del módulo, con el mismo formulario de «Soporte TI». Pide
 * `soporte.mesa_crear` (la ruta y el servidor lo exigen), no `soporte.crear`,
 * que es el de «Soporte TI». Para registrar uno en nombre de otra
 * persona está «Registrar ticket» (`soporte.registrar`): se le indica a quien
 * lo tiene.
 *
 * Menú, botón de la bandeja y título dicen lo mismo, «Pedir ayuda a su
 * nombre» (auditoría UX/UI, 09/11/2026).
 */
export function NuevoTicketPropio() {
  const puedeRegistrar = usePermission("soporte.registrar");
  // Volver a la bandeja solo si la puede abrir: con sus tickets en la Mesa o
  // siendo del equipo.
  const veMisSolicitudes = usePermission(PERMISO_MESA_MIS_TICKETS);
  const { user } = useAuth();
  const delEquipo = PERMISOS_SOPORTE.some((p) =>
    user?.permissions?.includes(p),
  );
  const veLaBandeja = veMisSolicitudes || delEquipo;
  return (
    <div className="soporte-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Pedir ayuda a su nombre</h2>
          <p className="mz-desc">
            Cuéntenos qué pasa y el equipo de TI le ayuda.{" "}
            {veMisSolicitudes
              ? "Lo sigue en «Mis tickets» de la bandeja."
              : "Lo sigue en «Soporte TI › Mis tickets»."}
            {puedeRegistrar && (
              <>
                {" "}
                ¿Es para otra persona? Use{" "}
                <Link to="/admin/soporte/registrar">Registrar ticket</Link>.
              </>
            )}
          </p>
        </div>
        {veLaBandeja && (
          <div className="mz-view-actions">
            <Link
              className="btn btn-outline-secondary btn-sm"
              to={veMisSolicitudes ? MIS_SOLICITUDES : "/admin/soporte/bandeja"}
            >
              Volver a la bandeja
            </Link>
          </div>
        )}
      </div>
      <NuevoTicket
        desdeLaMesa
        irAlCreado={veMisSolicitudes ? aMisSolicitudes : aSuDetalle}
      />
    </div>
  );
}
