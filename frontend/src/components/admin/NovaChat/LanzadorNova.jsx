import { useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { NOVA_CHAT } from "../../../api/novaService";
import { usePermission } from "../../../hooks/usePermission";
import { useModalA11y } from "../../../hooks/useModalA11y";
import { useEstadoModulos } from "../../../modulos/EstadoModulos";
import { Icon } from "../../common/Icon/Icon";
import { useChat } from "../Chat/ChatContext";
import { ConversacionNova } from "./ConversacionNova";
import "./ConversacionNova.css";

/** La página propia de Nova: ahí el botón flotante sobra. */
export const RUTA_NOVA = "/admin/nova";

/**
 * Si corresponde el botón flotante de Nova: con `nova.chat`, fuera de su
 * página y con Gestión Humana encendido en la empresa. Lo usan el botón y el
 * marco de `/admin` (que deja espacio al final para él), para que nunca
 * discrepen.
 */
export function useLanzadorNovaVisible() {
  const puede = usePermission(NOVA_CHAT);
  const { pathname } = useLocation();
  const { apagados } = useEstadoModulos();
  return puede && pathname !== RUTA_NOVA && !apagados.has("gestion_humana");
}

function CajonNova({ onCerrar, triggerRef }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
    triggerRef,
    // La conversación y el borrador siguen en el marco: cerrar no pierde nada.
    closeOnBackdrop: true,
    confirmarAlDescartar: false,
  });
  return (
    <div
      className="mz-overlay nova-fondo"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="mz-drawer nova-cajon"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nova-cajon-titulo"
        tabIndex={-1}
      >
        <div className="mz-panel-head nova-cajon__cabecera">
          <h2 id="nova-cajon-titulo" className="nova-cajon__titulo">
            <Icon name="stars" /> Nova
          </h2>
          <div className="nova-cajon__acciones">
            {/* Al llegar, la página pone el foco en su caja de texto. */}
            <Link
              to={RUTA_NOVA}
              state={{ enfocarNova: true }}
              className="btn btn-outline-secondary btn-sm"
              onClick={onCerrar}
            >
              <Icon name="arrows-angle-expand" /> Abrir en página
            </Link>
            <button
              type="button"
              className="mz-close"
              onClick={onCerrar}
              aria-label="Cerrar Nova"
            >
              <Icon name="x-lg" />
            </button>
          </div>
        </div>
        <ConversacionNova variante="panel" />
      </div>
    </div>
  );
}

/**
 * El botón flotante de Nova (Nexo: `NovaFab` en el `AppShell`), sobre el del
 * chat interno, para quien tiene `nova.chat`. Abre la conversación en un
 * panel lateral (a pantalla completa en el teléfono). No aparece en la página
 * de Nova ni con Gestión Humana apagado en la empresa. Tampoco mientras falta
 * aceptar el aviso de datos: la pantalla de consentimiento reemplaza todo el
 * marco de `/admin`, este botón incluido. Mientras el chat interno despliega
 * su panel o una ventana hacia arriba, el botón se oculta para no taparlos
 * (auditoría UX/UI de Nova, 09/11/2026); el panel de Nova, si está abierto,
 * sigue abierto.
 */
export function LanzadorNova() {
  const visible = useLanzadorNovaVisible();
  const chatAbierto = Boolean(useChat()?.abierto);
  const [abierto, setAbierto] = useState(false);
  const boton = useRef(null);

  if (!visible) return null;
  return (
    <>
      <button
        hidden={chatAbierto && !abierto}
        ref={boton}
        type="button"
        className="nova-lanzador"
        onClick={() => setAbierto(true)}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        title="Conversar con Nova, la asistente con IA"
      >
        <Icon name="stars" />
        <span className="nova-lanzador__texto">Nova</span>
        <span className="visually-hidden">: conversar con la asistente</span>
      </button>
      {abierto && (
        <CajonNova onCerrar={() => setAbierto(false)} triggerRef={boton} />
      )}
    </>
  );
}
