import { Link } from "react-router-dom";

import { usePermission } from "../../hooks/usePermission";
import { NuevoTicket } from "../Ayuda/NuevoTicket";
import "./Soporte.css";

/** Dónde se sigue un ticket propio creado desde la Mesa de ayuda. */
const MIS_SOLICITUDES = "/admin/soporte/bandeja?vista=creados";

/** Tras crearlo, a «Mis solicitudes» de la bandeja: no se sale del módulo. */
function aMisSolicitudes() {
  return { to: MIS_SOLICITUDES, texto: "Verlo en Mis solicitudes" };
}

/**
 * Mesa de ayuda → «Nuevo ticket» (09/11/2026): un ticket a su nombre desde
 * dentro del módulo, con el mismo formulario de «Soporte TI». Pide
 * `soporte.crear` (la ruta lo exige). Para registrar uno en nombre de otra
 * persona está «Registrar ticket» (`soporte.registrar`): se le indica a quien
 * lo tiene.
 *
 * El título no repite «Nuevo ticket», que ya dice la barra (auditoría UX/UI,
 * 09/11/2026).
 */
export function NuevoTicketPropio() {
  const puedeRegistrar = usePermission("soporte.registrar");
  return (
    <div className="soporte-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Pida ayuda a su nombre</h2>
          <p className="mz-desc">
            Cuéntenos qué pasa y el equipo de TI le ayuda. Lo sigue en «Mis
            solicitudes» de la bandeja.
            {puedeRegistrar && (
              <>
                {" "}
                ¿Es para otra persona? Use{" "}
                <Link to="/admin/soporte/registrar">Registrar ticket</Link>.
              </>
            )}
          </p>
        </div>
        <div className="mz-view-actions">
          <Link
            className="btn btn-outline-secondary btn-sm"
            to={MIS_SOLICITUDES}
          >
            Volver a la bandeja
          </Link>
        </div>
      </div>
      <NuevoTicket irAlCreado={aMisSolicitudes} />
    </div>
  );
}
