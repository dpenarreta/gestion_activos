import { useEffect, useState } from "react";

import { getEmpresaActiva } from "../../api/client";
import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";

/** Lo que ve quien no tiene un rol de la Matriz en la empresa activa. */
export function SinRolMatriz() {
  return (
    <div className="mz-card">
      <div className="mz-empty">
        <Icon name="shield-lock" />
        <p className="mb-1">
          No tiene un rol de la Matriz en la empresa activa.
        </p>
        <p className="mz-small mb-0">
          Pida a un administrador que se lo asigne en Configuración → Usuarios,
          o cambie de empresa desde la barra superior.
        </p>
      </div>
    </div>
  );
}

/**
 * Envuelve las pantallas de la Matriz: sin rol en la empresa activa, el
 * servidor responde 404 a todo (§8.4), y cada pantalla mostraría un escueto
 * «No encontrado». Aquí se dice qué falta y cómo resolverlo, igual en todas.
 * El menú ya no las ofrece, pero se llega por un enlace guardado o un correo.
 */
export function RequiereRolMatriz({ children }) {
  const [tieneRol, setTieneRol] = useState(undefined);

  useEffect(() => {
    let vigente = true;
    matrizService
      .misEmpresas()
      .then(({ empresas }) => {
        const activa = String(getEmpresaActiva() ?? "");
        const encontrada =
          empresas.find((e) => String(e.id) === activa) ??
          (activa ? null : empresas[0]);
        if (vigente) setTieneRol(Boolean(encontrada));
      })
      // Si no se pudo preguntar, que la pantalla lo intente y muestre su
      // propio error: no se tapa un fallo de red con «no tiene rol».
      .catch(() => vigente && setTieneRol(true));
    return () => {
      vigente = false;
    };
  }, []);

  if (tieneRol === undefined) return <div className="mz-empty">Cargando…</div>;
  return tieneRol ? children : <SinRolMatriz />;
}
