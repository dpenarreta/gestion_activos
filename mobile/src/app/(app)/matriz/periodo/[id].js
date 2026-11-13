import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { Alerta } from "../../../../componentes/comunes";
import { TEXTO_NO_DISPONIBLE } from "../../../../matriz/formato";
import { DetallePeriodo } from "../../../../pantallas/matriz/DetallePeriodo";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * `/matriz/periodo/ID?empresa=ID`: el detalle de una obligación de la Matriz
 * (US-019, CA-4), desde la Bandeja, una lista, el calendario, una
 * notificación o un push (CA-8). Solo IDs numéricos: pueden venir de un
 * enlace profundo; como mucho 12 dígitos.
 */
export default function Pantalla() {
  const parametros = useLocalSearchParams();
  const id = String(primero(parametros.id) ?? "");
  const empresa = String(primero(parametros.empresa) ?? "");
  if (!/^\d{1,12}$/.test(id)) {
    return (
      <View style={{ padding: 16 }}>
        <Alerta tipo="mal" texto={TEXTO_NO_DISPONIBLE} />
      </View>
    );
  }
  return <DetallePeriodo key={`${id}-${empresa}`} id={id} empresa={/^\d{1,12}$/.test(empresa) ? empresa : null} />;
}
