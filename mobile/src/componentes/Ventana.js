import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAlturaCabecera } from "../navegador/alturaCabecera";
import { colores } from "../tema/colores";
import { crearEstilos } from "../tema/tipografia";
import { BotonIcono } from "./comunes";

/**
 * Una ventana a pantalla completa con su título y «Cancelar», para los
 * formularios de una acción (US-019: los ajustes rápidos de la Matriz). Es la
 * misma que usa la ficha del ticket (US-014): el teclado no tapa los campos
 * (en Android se aparta con `KeyboardAvoidingView`; en iOS, con
 * `automaticallyAdjustKeyboardInsets`) y todo escala con la letra.
 *
 * `ocupada` (B-1 y P2-2, ronda 1): mientras guarda o envía no se cierra ni con la X
 * ni con Atrás de Android (el `Modal` es a pantalla completa: en iOS no se
 * cierra con un gesto). `refDesplazable`: el `ScrollView`, para llevar la
 * vista al primer campo con error (`useIrAlBloque`).
 */
export function Ventana({ titulo, subtitulo, onCerrar, children, testID, ocupada = false, refDesplazable }) {
  const alturaCabecera = useAlturaCabecera();
  const cerrar = () => {
    if (!ocupada) onCerrar();
  };
  return (
    <Modal visible animationType="slide" onRequestClose={cerrar}>
      <SafeAreaView style={estilos.ventana}>
        <View style={estilos.cabecera}>
          <View style={estilos.titulos}>
            <Text style={estilos.titulo} accessibilityRole="header">
              {titulo}
            </Text>
            {subtitulo ? <Text style={estilos.subtitulo}>{subtitulo}</Text> : null}
          </View>
          <BotonIcono
            icono="close"
            etiqueta="Cancelar"
            onPress={cerrar}
            deshabilitado={ocupada}
            testID={testID ? `${testID}-cerrar` : undefined}
          />
        </View>
        <KeyboardAvoidingView
          style={estilos.ventana}
          behavior="padding"
          enabled={Platform.OS === "android"}
          keyboardVerticalOffset={alturaCabecera}
        >
          <ScrollView
            ref={refDesplazable}
            contentContainerStyle={estilos.contenido}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            testID={testID}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const estilos = crearEstilos({
  ventana: { flex: 1, backgroundColor: colores.fondo },
  cabecera: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colores.superficie,
    borderBottomWidth: 1,
    borderBottomColor: colores.borde,
  },
  titulos: { flex: 1, gap: 2 },
  titulo: { fontSize: 18, fontWeight: "700", color: colores.titulo },
  subtitulo: { fontSize: 14, color: colores.tintaSuave },
  contenido: { padding: 16, gap: 14, paddingBottom: 40 },
});
