import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { Image, Modal, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { abrirConElSistema } from "../adjuntos/descargas";
import { colores } from "../tema/colores";
import { crearEstilos } from "../tema/tipografia";
import { Alerta, Boton, BotonIcono } from "./comunes";

export const TEXTO_SIN_VISOR_DE_IMAGENES =
  "No hay una aplicación para ver imágenes en este teléfono. Use los dedos para ampliarla aquí.";

/**
 * Una imagen descargada, dentro de la app y a pantalla completa (US-010;
 * compartido con el chat desde la US-011). Quien lo usa borra el archivo en
 * `onCerrar` (LOPDP).
 *
 * Fondo negro de la marca con la barra de estado clara y el título blanco
 * (21:1), como cualquier visor de fotos (auditoría UX, H-06 y H-22). En iOS
 * se amplía con los dedos (`maximumZoomScale` del `ScrollView`); en Android
 * ese zoom no existe sin una librería nativa, así que se ofrece «Ampliar con
 * el visor del teléfono», que abre `archivo` con la app del sistema
 * (decisión del usuario, 12/11/2026: sin librerías nativas nuevas).
 */
export function VisorDeImagen({
  uri,
  archivo,
  titulo,
  tituloPorDefecto = "Documento de respaldo",
  etiquetaImagen,
  onCerrar,
  testIDCerrar = "cerrar-documento",
  testIDImagen = "imagen-documento",
}) {
  const [errorAmpliar, setErrorAmpliar] = useState(null);
  // Ocupado mientras el sistema abre la imagen: un segundo toque no abre
  // otro visor (QA-TECH, N-18).
  const [ampliando, setAmpliando] = useState(false);
  const enCurso = useRef(false);
  const nombre = titulo || tituloPorDefecto;

  useEffect(() => {
    setErrorAmpliar(null);
  }, [uri]);

  async function ampliar() {
    if (enCurso.current) return;
    enCurso.current = true;
    setAmpliando(true);
    setErrorAmpliar(null);
    try {
      await abrirConElSistema(archivo, {
        mimeType: "image/*",
        titulo: nombre,
        textoSinVisor: TEXTO_SIN_VISOR_DE_IMAGENES,
      });
    } catch (e) {
      setErrorAmpliar({ texto: e?.message || TEXTO_SIN_VISOR_DE_IMAGENES, clave: Date.now() });
    } finally {
      enCurso.current = false;
      setAmpliando(false);
    }
  }

  return (
    <Modal visible={Boolean(uri)} animationType="slide" onRequestClose={onCerrar} presentationStyle="fullScreen">
      <SafeAreaView style={estilos.visor}>
        {/* El visor es oscuro: la barra de estado, clara. */}
        <StatusBar style="light" />
        <View style={estilos.visorCabecera}>
          <Text style={estilos.visorTitulo} accessibilityRole="header" numberOfLines={2}>
            {nombre}
          </Text>
          <BotonIcono icono="close" etiqueta="Cerrar" variante="oscuro" onPress={onCerrar} testID={testIDCerrar} />
        </View>
        {uri ? (
          <ScrollView
            style={estilos.visorZoom}
            contentContainerStyle={estilos.visorContenido}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
          >
            <Image
              testID={testIDImagen}
              source={{ uri }}
              style={estilos.imagen}
              resizeMode="contain"
              accessible
              accessibilityLabel={etiquetaImagen ?? `${tituloPorDefecto}: ${titulo || "imagen"}`}
            />
          </ScrollView>
        ) : null}
        {Platform.OS === "android" && archivo ? (
          <View style={estilos.pie}>
            {errorAmpliar ? <Alerta tipo="mal" texto={errorAmpliar.texto} clave={errorAmpliar.clave} /> : null}
            <Boton
              testID="ampliar-imagen"
              titulo="Ampliar con el visor del teléfono"
              icono="magnify-plus-outline"
              variante="sobreOscuro"
              cargando={ampliando}
              pista="Abre la imagen en la aplicación de fotos del teléfono, donde se puede ampliar"
              onPress={() => {
                ampliar();
              }}
            />
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const estilos = crearEstilos({
  visor: { flex: 1, backgroundColor: colores.marcaNegro },
  visorCabecera: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  visorTitulo: { flex: 1, fontSize: 16, fontWeight: "700", color: colores.sobreCabecera },
  visorZoom: { flex: 1 },
  visorContenido: { flexGrow: 1, justifyContent: "center", alignItems: "center" },
  imagen: { width: "100%", height: "100%", minHeight: 300 },
  pie: { gap: 8, padding: 12 },
});
