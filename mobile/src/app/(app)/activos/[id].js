import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { TEXTO_NO_DISPONIBLE } from "../../../activos/formato";
import { Alerta } from "../../../componentes/comunes";
import { FichaActivo } from "../../../pantallas/activos/FichaActivo";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * `/activos/ID?empresa=ID`: la ficha de un activo (US-022, CA-7), desde el
 * panel, el inventario, el escáner o un aviso (CA-21). Solo IDs numéricos:
 * pueden venir de un enlace profundo; como mucho 12 dígitos.
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
  return <FichaActivo key={`${id}-${empresa}`} id={id} empresa={/^\d{1,12}$/.test(empresa) ? empresa : null} />;
}
