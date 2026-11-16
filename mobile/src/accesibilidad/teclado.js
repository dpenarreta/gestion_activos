import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Si el teclado está abierto (de `BarraDeFuncionalidades`, US-016; aparte
 * desde la US-024 para el pie fijo de «Nuevo grupo»). Lo que se aparta con
 * el teclado no tapa el campo ni le quita alto a la pantalla. En iOS, con
 * los eventos «Will» (H-15), para que se aparte a la vez que sube el teclado;
 * Android solo tiene los «Did».
 */
export function useTecladoAbierto() {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const mostrar = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setAbierto(true));
    const ocultar = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setAbierto(false));
    return () => {
      mostrar.remove();
      ocultar.remove();
    };
  }, []);
  return abierto;
}
