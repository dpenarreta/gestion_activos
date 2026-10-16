import { useEffect, useState } from "react";

import { alertasService } from "../../../api/alertasService";
import { Icon } from "../../../components/common/Icon/Icon";
import { ConfiguracionAlertas } from "../Alertas/ConfiguracionAlertas";

/**
 * Configuración → Notificaciones → Alertas del inventario: umbrales, alertas
 * activas y el resumen por correo, con su prueba y el historial de envíos.
 */
export function NotificacionesAlertasPage() {
  const [configuracion, setConfiguracion] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  // Sube al guardar, para que el formulario arranque de lo guardado.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    alertasService
      .configuracion()
      .then(setConfiguracion)
      .catch(() => setError("No se pudo cargar la configuración de alertas."));
  }, []);

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Alertas del inventario</h2>
          <p className="mz-desc">
            Qué alertas se calculan, con qué umbrales, y a quién llega el
            resumen por correo.
          </p>
        </div>
      </div>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="check2-circle" />
          {aviso}
        </div>
      )}
      {!configuracion && !error && <div className="mz-empty">Cargando…</div>}
      {configuracion && (
        <ConfiguracionAlertas
          key={version}
          inicial={configuracion}
          onGuardado={(guardada) => {
            if (guardada) setConfiguracion(guardada);
            setVersion((v) => v + 1);
            setAviso("Configuración guardada.");
          }}
        />
      )}
    </div>
  );
}
