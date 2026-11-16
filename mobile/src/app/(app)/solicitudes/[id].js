import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { Alerta } from "../../../componentes/comunes";
import {
  DetalleSolicitudDeEquipo,
  TEXTO_SOLICITUD_NO_DISPONIBLE,
} from "../../../pantallas/activos/DetalleSolicitudDeEquipo";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * `/solicitudes/ID?empresa=ID`: el detalle de una solicitud de equipo
 * (US-022, CA-18 y CA-20), desde «Mis solicitudes», «Recibidas» o un aviso
 * (CA-21). No es la solicitud de permiso (`/permisos/solicitud/ID`). Solo IDs
 * numéricos de hasta 12 dígitos: pueden venir de un enlace profundo.
 */
export default function Pantalla() {
  const parametros = useLocalSearchParams();
  const id = String(primero(parametros.id) ?? "");
  const empresa = String(primero(parametros.empresa) ?? "");
  if (!/^\d{1,12}$/.test(id)) {
    return (
      <View style={{ padding: 16 }}>
        <Alerta tipo="mal" texto={TEXTO_SOLICITUD_NO_DISPONIBLE} />
      </View>
    );
  }
  return <DetalleSolicitudDeEquipo key={`${id}-${empresa}`} id={id} empresa={/^\d{1,12}$/.test(empresa) ? empresa : null} />;
}
