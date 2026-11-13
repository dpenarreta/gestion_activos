import { useLocalSearchParams } from "expo-router";

import { DetalleSolicitud, SolicitudNoEncontrada } from "../../../../pantallas/permisos/DetalleSolicitud";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * `/permisos/solicitud/ID?empresa=ID`: desde la lista, una notificación o un
 * push. Solo IDs numéricos: pueden venir de un enlace profundo.
 */
export default function PantallaDetalleSolicitud() {
  const parametros = useLocalSearchParams();
  const id = String(primero(parametros.id) ?? "");
  const empresa = String(primero(parametros.empresa) ?? "");
  // Un id que no es un número no existe: se dice, con «Volver».
  if (!/^\d+$/.test(id)) return <SolicitudNoEncontrada />;
  return (
    <DetalleSolicitud
      key={`${id}-${empresa}`}
      id={id}
      empresa={/^\d+$/.test(empresa) ? empresa : null}
      creada={primero(parametros.creada) === "1"}
    />
  );
}
