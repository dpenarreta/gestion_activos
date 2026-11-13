import { SoloConFoco } from "../../../navegacion/EstadoDeModulos";
import { Permisos } from "../../../pantallas/permisos/Permisos";

/** `/permisos?seccion=mias|por_aprobar|vacaciones`: Institucional. Sin el
 * foco no recibe toques (ronda 2). */
export default function PantallaPermisos() {
  return (
    <SoloConFoco>
      <Permisos />
    </SoloConFoco>
  );
}
