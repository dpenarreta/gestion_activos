import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { Alerta } from "../../../../componentes/comunes";
import { estadoDeLaBandeja } from "../../../../matriz/formato";
import { ListaDePeriodos } from "../../../../pantallas/matriz/ListaDePeriodos";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * `/matriz/estado/incumplido|en_progreso|proximas|finalizado`: las
 * obligaciones de una tarjeta de la Bandeja (US-019, CA-3), con los mismos
 * filtros que la web (`status` y, en las próximas, `sort=due`).
 */
export default function Pantalla() {
  const parametros = useLocalSearchParams();
  const estado = estadoDeLaBandeja(String(primero(parametros.estado) ?? ""));
  if (!estado) {
    return (
      <View style={{ padding: 16 }}>
        <Alerta tipo="mal" texto="Esta lista no existe." />
      </View>
    );
  }
  return (
    <ListaDePeriodos
      key={estado.clave}
      testID={`lista-${estado.clave}`}
      params={estado.params}
      nota={estado.nota}
      textoVacio="No hay obligaciones en este estado."
    />
  );
}
