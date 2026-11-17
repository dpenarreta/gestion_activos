import { SoloConFoco } from "../../../navegacion/EstadoDeModulos";
import { OrdenesDeTrabajo } from "../../../pantallas/ordenes/OrdenesDeTrabajo";

/** `/ordenes?vista=panel|mis`: Órdenes de trabajo (US-025). Sin el foco no
 * recibe toques (US-016, ronda 2). */
export default function PantallaOrdenes() {
  return (
    <SoloConFoco>
      <OrdenesDeTrabajo />
    </SoloConFoco>
  );
}
