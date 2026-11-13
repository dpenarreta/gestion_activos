import { useMemo, useState } from "react";

import { adminUsersService } from "../../../api/adminUsersService";
import { EtiquetaAusencia } from "../../../components/common/Ausencia/EtiquetaAusencia";
import {
  ReemplazoEnAusencia,
  TEXTOS_POR_OTRA,
  useReemplazoEnAusencia,
} from "../../../components/common/Ausencia/ReemplazoEnAusencia";
import { Icon } from "../../../components/common/Icon/Icon";

/*
 * La tarjeta «Mientras no está» de la ficha del usuario (US-018, 13/11/2026).
 *
 * Quién aprueba por esta persona mientras está ausente: su jefe inmediato u
 * otra persona. Es la misma elección que ella hace en «Chat › Mi estado» (se
 * guarda en la empresa activa) y la ve y la puede cambiar. Se ve con
 * `usuarios.ver`; se cambia con `usuarios.reemplazo`. Sin ese permiso, solo
 * para leer.
 *
 * Al guardar, la persona recibe un aviso en la campana y, si hoy está
 * ausente, sus aprobaciones pendientes pasan enseguida al nuevo reemplazo.
 */
export function ReemplazoDeLaCuenta({ usuarioId, puedeEditar }) {
  const servicio = useMemo(
    () => ({
      obtener: () => adminUsersService.reemplazo(usuarioId),
      guardar: (datos) => adminUsersService.guardarReemplazo(usuarioId, datos),
    }),
    [usuarioId],
  );
  const reemplazo = useReemplazoEnAusencia({
    servicio,
    textos: TEXTOS_POR_OTRA,
  });
  const [exito, setExito] = useState(null);
  const [aviso, setAviso] = useState(null);

  async function guardar(evento) {
    evento.preventDefault();
    setExito(null);
    setAviso(null);
    const resultado = await reemplazo.guardar();
    if (!resultado.ok) {
      setAviso(resultado.mensaje);
      return;
    }
    setExito(
      resultado.guardado
        ? "Quedó guardado. La persona recibió un aviso en la campana."
        : "No había cambios que guardar.",
    );
  }

  const ausencia = reemplazo.datos?.ausencia;

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Mientras no está</h3>
      </div>
      <form className="mz-card-body" onSubmit={guardar} noValidate>
        {ausencia && (
          <p className="mb-3">
            <span className="mz-strong">Hoy: </span>
            <EtiquetaAusencia ausencia={ausencia} />
          </p>
        )}
        {/* Región viva siempre montada: el resultado llega después. */}
        <div role="status">
          {exito && (
            <div className="mz-alert mz-alert--ok">
              <Icon name="check2-circle" />
              {exito}
            </div>
          )}
          {aviso && (
            <div className="mz-alert mz-alert--bad">
              <Icon name="x-octagon" />
              {aviso}
            </div>
          )}
        </div>
        <ReemplazoEnAusencia
          reemplazo={{
            ...reemplazo,
            // Sin el encabezado del bloque: la tarjeta ya lo lleva.
            textos: { ...reemplazo.textos, encabezado: null },
          }}
          deshabilitado={!puedeEditar}
        />
        {puedeEditar ? (
          <div className="mz-actions justify-content-end mt-3">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!reemplazo.datos || reemplazo.guardando}
            >
              {reemplazo.guardando ? "Guardando…" : "Guardar quién aprueba"}
            </button>
          </div>
        ) : (
          <p className="form-text mb-0 mt-2">
            Solo puede verlo. Para cambiarlo hace falta el permiso «Configurar
            quién aprueba por otra persona mientras está ausente».
          </p>
        )}
      </form>
    </section>
  );
}
