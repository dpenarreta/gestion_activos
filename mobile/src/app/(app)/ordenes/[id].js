import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { Alerta } from "../../../componentes/comunes";
import { TEXTO_NO_DISPONIBLE } from "../../../ordenes/formato";
import { FichaOrden } from "../../../pantallas/ordenes/FichaOrden";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * `/ordenes/ID?empresa=ID`: la ficha de una orden de trabajo (US-025, CA-9),
 * desde el panel, «Mis órdenes» o tras registrarla. Solo IDs numéricos (puede
 * venir de un enlace profundo), de hasta 12 dígitos.
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
  return <FichaOrden key={`${id}-${empresa}`} id={id} empresa={/^\d{1,12}$/.test(empresa) ? empresa : null} />;
}
