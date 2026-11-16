import * as Linking from "expo-linking";
import { useIsFocused } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";

import { camaraDisponible } from "../../activos/camara";
import { serieLeida } from "../../activos/fichaTecnica";
import { Alerta, Boton, BotonIcono, Cargando } from "../../componentes/comunes";
import { Ventana } from "../../componentes/Ventana";
import { colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";

/** Los códigos de las etiquetas de fabricante (`BarcodeType` de
 * `expo-camera` 58): el S/N suele ir en Code 128 o Code 39; los EAN y UPC,
 * en las cajas; QR, Data Matrix y PDF417, en equipos más nuevos. */
export const TIPOS_DE_ETIQUETA_DE_FABRICANTE = [
  "code128",
  "code39",
  "code93",
  "ean13",
  "ean8",
  "upc_a",
  "upc_e",
  "qr",
  "datamatrix",
  "pdf417",
];

export const ETIQUETA_ESCANEAR_SERIE = "Escanear el número de serie de la etiqueta del fabricante";
export const TEXTO_INSTRUCCION_SERIE = "Apunte al código de barras de la etiqueta del fabricante (S/N).";
export const TEXTO_SIN_PERMISO_CAMARA_SERIE =
  "La app no tiene permiso para usar la cámara. Puede darlo en los ajustes del teléfono o escribir el número de serie a mano.";

/**
 * La cámara con su permiso, para leer el S/N. Es una copia mínima de
 * `VistaDeCamara` de `Escaner.js` (no se extrajo una pieza común para no
 * tocar ese archivo, que tiene cambios sin publicar de la burbuja de
 * «Escanear»): si el permiso no se decidió, se pide al abrir; si se negó,
 * se explica y se ofrece «Abrir los ajustes»; al volver de ellos se lee
 * otra vez.
 */
function VistaDeCamaraSerie({ camara, onLeido }) {
  const { CameraView, useCameraPermissions } = camara;
  const [permiso, pedirPermiso, obtenerPermiso] = useCameraPermissions();
  const pedido = useRef(false);
  const leido = useRef(false);

  useEffect(() => {
    if (pedido.current || !permiso || permiso.granted || !permiso.canAskAgain) return;
    pedido.current = true;
    Promise.resolve(pedirPermiso()).catch(() => {});
  }, [permiso, pedirPermiso]);

  useEffect(() => {
    if (typeof obtenerPermiso !== "function") return undefined;
    const suscripcion = AppState.addEventListener("change", (estado) => {
      if (estado === "active") obtenerPermiso().catch(() => {});
    });
    return () => suscripcion.remove();
  }, [obtenerPermiso]);

  // Un código a la vez: el primero que deje algo legible cierra la ventana.
  function alLeer(evento) {
    if (leido.current) return;
    const texto = serieLeida(evento?.data);
    if (!texto) return;
    leido.current = true;
    onLeido(texto);
  }

  if (!permiso) return <Cargando texto="Preparando la cámara…" />;
  if (!permiso.granted) {
    return (
      <View style={estilos.bloque} testID="serie-sin-permiso">
        <Alerta
          tipo="info"
          texto={permiso.canAskAgain ? "Para leer la etiqueta, la app necesita usar la cámara." : TEXTO_SIN_PERMISO_CAMARA_SERIE}
        />
        {permiso.canAskAgain ? (
          <Boton testID="serie-dar-permiso" titulo="Usar la cámara" icono="camera-outline" onPress={pedirPermiso} />
        ) : (
          <Boton
            testID="serie-abrir-ajustes"
            titulo="Abrir los ajustes"
            icono="cog-outline"
            variante="secundario"
            onPress={() => {
              Linking.openSettings().catch(() => {});
            }}
          />
        )}
      </View>
    );
  }
  return (
    <View style={estilos.marco} accessible accessibilityLabel={`Cámara. ${TEXTO_INSTRUCCION_SERIE} Se lee sola.`} testID="serie-camara">
      <CameraView
        style={estilos.camara}
        facing="back"
        active
        barcodeScannerSettings={{ barcodeTypes: TIPOS_DE_ETIQUETA_DE_FABRICANTE }}
        onBarcodeScanned={alLeer}
      />
    </View>
  );
}

/**
 * Escanear el S/N de la etiqueta del fabricante (US-023, UX H-15): un botón
 * junto al campo que abre una ventana con la cámara, sin navegar (el
 * formulario no se pierde). Lee el primer código, lo limpia y lo devuelve con
 * `onLeido(texto)`. Solo aparece si el binario trae la cámara
 * (`camaraDisponible`); sin ella, el campo sigue igual. La cámara solo está
 * montada con la ventana abierta y la pantalla enfocada (P2 de la US-022).
 */
export function BotonEscanearSerie({ onLeido, deshabilitado = false }) {
  const camara = camaraDisponible();
  const enfocada = useIsFocused();
  const [abierta, setAbierta] = useState(false);
  if (!camara) return null;
  return (
    <>
      <BotonIcono
        testID="escanear-serie"
        icono="barcode-scan"
        variante="contorno"
        etiqueta={ETIQUETA_ESCANEAR_SERIE}
        deshabilitado={deshabilitado}
        onPress={() => setAbierta(true)}
      />
      {abierta ? (
        <Ventana titulo="Escanear el número de serie" onCerrar={() => setAbierta(false)} testID="ventana-serie">
          <Text style={estilos.instruccion}>{TEXTO_INSTRUCCION_SERIE}</Text>
          {enfocada ? (
            <VistaDeCamaraSerie
              camara={camara}
              onLeido={(texto) => {
                setAbierta(false);
                onLeido(texto);
              }}
            />
          ) : null}
          <Boton testID="cancelar-serie" titulo="Cancelar" variante="secundario" onPress={() => setAbierta(false)} />
        </Ventana>
      ) : null}
    </>
  );
}

const estilos = crearEstilos({
  bloque: { gap: 10 },
  instruccion: { fontSize: 16, color: colores.tinta },
  marco: { borderRadius: 12, overflow: "hidden", backgroundColor: colores.marcaNegro, aspectRatio: 3 / 4, maxHeight: 460 },
  camara: { flex: 1 },
});
