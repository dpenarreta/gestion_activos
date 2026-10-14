import { Link } from "react-router-dom";

import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";
import { ListadoDeSolicitudes } from "./ListadoDeSolicitudes";

/** Lo que yo pedí, en el punto en que está. */
export function MisSolicitudes() {
  const puedeCrear = usePermission("solicitudes.crear");

  return (
    <ListadoDeSolicitudes
      ambito="mias"
      titulo="Mis solicitudes"
      descripcion="Lo que usted pidió y en qué punto está cada cosa."
      acciones={
        puedeCrear && (
          <Link
            className="btn btn-primary btn-sm"
            to="/admin/solicitudes/nueva"
          >
            <Icon name="plus-lg" /> Realizar solicitud
          </Link>
        )
      }
    />
  );
}
