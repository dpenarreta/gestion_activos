import { Icon } from "../../../components/common/Icon/Icon";
import { Semaforo } from "../Desempeno/Componentes";
import { ESTADOS } from "./llamadosComunes";

/** El estado de un llamado: su texto y su ícono, además del color. */
export function PildoraEstado({ estado }) {
  const datos = ESTADOS[estado];
  return (
    <Semaforo tono={datos?.tono ?? "neutral"}>
      {datos && <Icon name={datos.icono} />} {datos?.texto ?? estado}
    </Semaforo>
  );
}
