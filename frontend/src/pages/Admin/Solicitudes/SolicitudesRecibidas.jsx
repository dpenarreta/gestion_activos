import { usePermission } from "../../../hooks/usePermission";
import { ListadoDeSolicitudes } from "./ListadoDeSolicitudes";

/** Lo que me toca gestionar: lo que me asignaron, o todo si administro compras. */
export function SolicitudesRecibidas() {
  const administra = usePermission("solicitudes.administrar");

  return (
    <ListadoDeSolicitudes
      ambito="recibidas"
      titulo="Solicitudes recibidas"
      descripcion={
        administra
          ? "Las solicitudes de toda la empresa, incluidas las asignadas a otras personas."
          : "Lo que le asignaron para comprar. Aquí se toma, se compra y se entrega."
      }
    />
  );
}
