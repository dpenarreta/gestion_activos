import { Alert } from "react-native";

/**
 * Antes de cerrar un formulario con cambios sin guardar, se pregunta (H-17 de
 * la US-014 en la ficha del ticket; H-01 de la US-019 en los ajustes de la
 * Matriz). Resuelve `true` si la persona descarta. Tocar fuera o Atrás es
 * «seguir escribiendo».
 */
export function confirmarDescarte({
  titulo = "¿Descartar lo que escribió?",
  mensaje = "Los cambios no se guardaron.",
} = {}) {
  return new Promise((resolver) => {
    Alert.alert(
      titulo,
      mensaje,
      [
        { text: "Seguir escribiendo", style: "cancel", onPress: () => resolver(false) },
        { text: "Descartar", style: "destructive", onPress: () => resolver(true) },
      ],
      { cancelable: true, onDismiss: () => resolver(false) },
    );
  });
}
