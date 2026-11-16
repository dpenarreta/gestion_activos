import { SoloConFoco } from "../../../navegacion/EstadoDeModulos";
import { GestionDeActivos } from "../../../pantallas/activos/GestionDeActivos";

/** `/activos?vista=panel|inventario|mantenimientos|mis_solicitudes|recibidas`:
 * Gestión de Activos (US-022). Sin el foco no recibe toques (US-016,
 * ronda 2). */
export default function PantallaActivos() {
  return (
    <SoloConFoco>
      <GestionDeActivos />
    </SoloConFoco>
  );
}
