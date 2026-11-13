import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { Alerta } from "../../../../componentes/comunes";
import { Conversacion } from "../../../../pantallas/chat/Conversacion";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * `/chat/conversacion/ID?empresa=ID`: desde la lista, «Nuevo mensaje», una
 * notificación o un push (US-011). Solo IDs numéricos: pueden venir de un
 * enlace profundo.
 */
export default function PantallaConversacion() {
  const parametros = useLocalSearchParams();
  const id = String(primero(parametros.id) ?? "");
  const empresa = String(primero(parametros.empresa) ?? "");
  if (!/^\d+$/.test(id)) {
    return (
      <View style={{ padding: 16 }}>
        <Alerta tipo="mal" texto="Esta conversación no existe." />
      </View>
    );
  }
  return <Conversacion key={`${id}-${empresa}`} id={id} empresa={/^\d+$/.test(empresa) ? empresa : null} />;
}
