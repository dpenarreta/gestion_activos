import { SoloConFoco } from "../../../navegacion/EstadoDeModulos";
import { Matriz } from "../../../pantallas/matriz/Matriz";

/** `/matriz?vista=bandeja|calendario`: la Matriz de obligaciones (US-019).
 * Sin el foco no recibe toques (US-016, ronda 2). */
export default function PantallaMatriz() {
  return (
    <SoloConFoco>
      <Matriz />
    </SoloConFoco>
  );
}
