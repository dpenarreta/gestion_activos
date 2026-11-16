import { Alert } from "react-native";

export const TITULO_SALIR = "¿Salir al navegador?";
export const TEXTO_SALIR =
  "Esto se abre en el navegador del teléfono, fuera de la app. Cuando termine, puede volver a la app.";

/**
 * Antes de salir de la app, se pregunta (16/11/2026, a pedido del usuario:
 * «que confirmen que van a salir»). Resuelve `true` si la persona sigue.
 * Tocar fuera o Atrás es quedarse en la app.
 */
export function confirmarSalida() {
  return new Promise((resolver) => {
    Alert.alert(
      TITULO_SALIR,
      TEXTO_SALIR,
      [
        { text: "Quedarme en la app", style: "cancel", onPress: () => resolver(false) },
        { text: "Abrir el navegador", onPress: () => resolver(true) },
      ],
      { cancelable: true, onDismiss: () => resolver(false) },
    );
  });
}
