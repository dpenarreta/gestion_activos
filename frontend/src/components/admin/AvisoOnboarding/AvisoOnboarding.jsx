import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { capacitacionService } from "../../../api/capacitacionService";
import { Icon } from "../../common/Icon/Icon";
import { formatearFecha } from "../../../utils/formato";
import "./AvisoOnboarding.css";

/**
 * El aviso fijo del onboarding pendiente: no bloquea el sistema, pero se ve
 * en todas las pantallas (y no se cierra) hasta aprobar todo el plan.
 */
export function AvisoOnboarding() {
  const [datos, setDatos] = useState(null);
  const { pathname } = useLocation();

  useEffect(() => {
    let vigente = true;
    Promise.resolve(capacitacionService.miOnboarding?.())
      .then((r) => vigente && setDatos(r ?? null))
      .catch(() => vigente && setDatos(null));
    return () => {
      vigente = false;
    };
  }, [pathname]);

  if (!datos?.asignado || datos.completado_en || !datos.total) return null;
  if (pathname.endsWith("/institucional/onboarding")) return null;

  return (
    <div
      className={`aviso-onboarding${datos.vencido ? " aviso-onboarding--vencido" : ""}`}
      role="status"
    >
      <Icon name="mortarboard" />
      <span>
        <strong>Tiene su onboarding pendiente:</strong> {datos.aprobados} de{" "}
        {datos.total} materiales aprobados ·{" "}
        {datos.vencido ? "venció el " : "complételo antes del "}
        {formatearFecha(datos.fecha_limite)}.
      </span>
      <Link
        className="btn btn-sm btn-light"
        to="/admin/institucional/onboarding"
      >
        Continuar
      </Link>
    </div>
  );
}
