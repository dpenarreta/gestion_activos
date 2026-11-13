import { useEffect, useState } from "react";
import { AppState, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { mensajeDeError } from "../api/errores";
import { Alerta, Boton } from "../componentes/comunes";
import { abrirEnNavegador, urlWeb } from "../navegador/enlaceWeb";
import { useSesion } from "../sesion/SesionContext";
import { useCerrarSesion } from "../sesion/useCerrarSesion";
import { colores } from "../tema/colores";
import { crearEstilos } from "../tema/tipografia";

export const TEXTO_CONTRASENA =
  "Antes de continuar, cambie su contraseña en la web de la intranet. Al cambiarla, la " +
  "sesión de este teléfono se cerrará y tendrá que volver a entrar con la contraseña nueva.";
export const TEXTO_CONSENTIMIENTO =
  "Antes de continuar, lea y acepte el aviso de privacidad en la web de la intranet. Luego " +
  "vuelva aquí y pulse «Ya lo hice».";

/**
 * Lo que hay que hacer en la web antes de usar la app: cambiar la contraseña
 * (`must_change_password`) o aceptar el aviso de privacidad de la empresa
 * (`me.consentimiento.pendiente`, 09/11/2026). La aceptación queda registrada
 * con su versión en la web; la app solo vuelve a preguntar a `/auth/me/`.
 *
 * Con la contraseña no hay «Ya lo hice»: el cambio en la web revoca las
 * demás sesiones, la de este teléfono incluida, y la app vuelve sola al login
 * en la siguiente petición (revisión de QA-UX, 12/11/2026).
 */
export function AccionPendiente() {
  const { usuario, empresaActiva, recargarUsuario } = useSesion();
  const { cerrando, confirmarCierre } = useCerrarSesion();
  const [comprobando, setComprobando] = useState(false);
  const [error, setError] = useState(null);
  const esContrasena = Boolean(usuario?.must_change_password);

  // Al volver de la web tras cambiar la contraseña, una consulta basta para
  // que el servidor diga que la sesión terminó y la app vaya al login.
  useEffect(() => {
    if (!esContrasena) return undefined;
    const suscripcion = AppState.addEventListener("change", (s) => {
      if (s === "active") recargarUsuario().catch(() => {});
    });
    return () => suscripcion.remove();
  }, [esContrasena, recargarUsuario]);

  const titulo = esContrasena ? "Debe cambiar su contraseña" : "Falta aceptar el aviso de privacidad";
  // El aviso de privacidad es por empresa: la web debe abrir la misma.
  const url = urlWeb(esContrasena ? "/change-password-required" : "/", {
    empresa: empresaActiva?.id,
  });

  async function comprobar() {
    setComprobando(true);
    setError(null);
    try {
      const me = await recargarUsuario();
      if (me?.must_change_password || me?.consentimiento?.pendiente) {
        setError("Todavía figura como pendiente. Complételo en la web e intente de nuevo.");
      }
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setComprobando(false);
    }
  }

  return (
    <SafeAreaView style={estilos.pantalla}>
      <ScrollView contentContainerStyle={estilos.contenido}>
        <Text style={estilos.titulo} accessibilityRole="header">
          {titulo}
        </Text>
        <Text style={estilos.texto}>{esContrasena ? TEXTO_CONTRASENA : TEXTO_CONSENTIMIENTO}</Text>
        {error && <Alerta texto={error} tipo="mal" />}
        <Boton titulo="Abrir en el navegador" icono="open-in-new" onPress={() => abrirEnNavegador(url)} />
        {!esContrasena && (
          <Boton titulo="Ya lo hice" variante="secundario" cargando={comprobando} onPress={comprobar} />
        )}
        <Boton
          titulo="Cerrar sesión"
          variante="secundario"
          icono="logout"
          cargando={cerrando}
          onPress={confirmarCierre}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 16 },
  titulo: { fontSize: 22, fontWeight: "700", color: colores.tinta },
  texto: { fontSize: 16, color: colores.tintaSuave },
});
