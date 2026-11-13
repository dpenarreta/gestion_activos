import { SoloConFoco } from "../../../navegacion/EstadoDeModulos";
import { MesaDeAyuda } from "../../../pantallas/soporte/MesaDeAyuda";

/** `/soporte?vista=mis|bandeja|aprobaciones`: la Mesa de ayuda (US-014). Sin
 * el foco no recibe toques (US-016, ronda 2). */
export default function PantallaMesaDeAyuda() {
  return (
    <SoloConFoco>
      <MesaDeAyuda />
    </SoloConFoco>
  );
}
