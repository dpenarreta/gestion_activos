import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { Alerta } from "../../../componentes/comunes";
import { DetalleMantenimiento, TEXTO_MANTENIMIENTO_NO_DISPONIBLE } from "../../../pantallas/activos/DetalleMantenimiento";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * `/mantenimientos/ID?empresa=ID`: el detalle de un mantenimiento (US-022,
 * CA-13), desde la bitácora, la ficha del activo o tras registrarlo. Solo
 * IDs numéricos (pueden venir de un enlace profundo), de hasta 12 dígitos.
 */
export default function Pantalla() {
  const parametros = useLocalSearchParams();
  const id = String(primero(parametros.id) ?? "");
  const empresa = String(primero(parametros.empresa) ?? "");
  if (!/^\d{1,12}$/.test(id)) {
    return (
      <View style={{ padding: 16 }}>
        <Alerta tipo="mal" texto={TEXTO_MANTENIMIENTO_NO_DISPONIBLE} />
      </View>
    );
  }
  return <DetalleMantenimiento key={`${id}-${empresa}`} id={id} empresa={/^\d{1,12}$/.test(empresa) ? empresa : null} />;
}
