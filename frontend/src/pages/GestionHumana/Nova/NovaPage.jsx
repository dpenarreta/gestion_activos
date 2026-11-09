import { Link, useLocation } from "react-router-dom";

import {
  NOVA_CONOCIMIENTO_GESTIONAR,
  NOVA_CONOCIMIENTO_VER,
} from "../../../api/novaService";
import { ConversacionNova } from "../../../components/admin/NovaChat/ConversacionNova";
import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";

/**
 * Nova (Nexo: página `/assistant`): la misma conversación que el botón
 * flotante, a pantalla completa. Exige `nova.chat` (la ruta y el servidor).
 * Al llegar desde «Abrir en página» del panel, el foco va a la caja de texto.
 */
export function NovaPage() {
  const { state } = useLocation();
  const ve = usePermission(NOVA_CONOCIMIENTO_VER);
  const gestiona = usePermission(NOVA_CONOCIMIENTO_GESTIONAR);
  const veConocimiento = ve || gestiona;
  return (
    <div className="nova-pagina">
      <div className="mz-view-head">
        <div>
          <h2>Nova</h2>
          <p className="mz-desc">
            La asistente de Gestión Humana con IA: pregúntele por sus tareas, su
            equipo o los documentos de la empresa.
          </p>
        </div>
        {veConocimiento && (
          <div className="mz-view-actions">
            <Link
              to="/admin/nova/conocimiento"
              className="btn btn-outline-secondary btn-sm"
            >
              <Icon name="journal-text" /> Base de conocimiento
            </Link>
          </div>
        )}
      </div>
      <section className="mz-card p-3">
        <ConversacionNova
          variante="pagina"
          enfocar={Boolean(state?.enfocarNova)}
        />
      </section>
    </div>
  );
}
