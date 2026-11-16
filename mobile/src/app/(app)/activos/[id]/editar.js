import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { TEXTO_NO_DISPONIBLE } from "../../../../activos/formato";
import { Alerta } from "../../../../componentes/comunes";
import { FormularioActivo } from "../../../../pantallas/activos/FormularioActivo";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * `/activos/ID/editar`: «Editar» la ficha técnica (US-023, CA-4), desde la
 * ficha con `activos.editar`. Siempre en la empresa activa. Solo IDs
 * numéricos, de hasta 12 dígitos: puede venir de un enlace profundo.
 */
export default function Pantalla() {
  const parametros = useLocalSearchParams();
  const id = String(primero(parametros.id) ?? "");
  if (!/^\d{1,12}$/.test(id)) {
    return (
      <View style={{ padding: 16 }}>
        <Alerta tipo="mal" texto={TEXTO_NO_DISPONIBLE} />
      </View>
    );
  }
  return <FormularioActivo key={id} id={id} />;
}
