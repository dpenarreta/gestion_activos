import { SoloConFoco } from "../../../navegacion/EstadoDeModulos";
import { Inicio } from "../../../pantallas/Inicio";

/** `/`: Institucional › Inicio. Sin el foco no recibe toques (ronda 2). */
export default function PantallaInicio() {
  return (
    <SoloConFoco>
      <Inicio />
    </SoloConFoco>
  );
}
