import * as Linking from "expo-linking";
import { useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, ScrollView, Text, TextInput, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { activosService } from "../../api/servicios";
import { camaraDisponible } from "../../activos/camara";
import {
  activoDelCodigo,
  codigoFueraDeRuta,
  codigoLeido,
  estaOperativo,
  lugarDe,
  mensajeDeActivos,
  resumenDelEscaneo,
  TEXTO_CODIGO_AMBIGUO,
  TEXTO_CODIGO_NO_ENCONTRADO,
  TEXTO_NO_DISPONIBLE,
} from "../../activos/formato";
import { Alerta, Boton, Cargando } from "../../componentes/comunes";
import { useSesion } from "../../sesion/SesionContext";
import { colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { crearEstilos } from "../../tema/tipografia";
import { rutaDeRegistrarMantenimiento } from "./FichaActivo";
import { EstadoDelActivo, useMontado } from "./piezas";

/** El QR de la etiqueta y el Code 128 de la pistola (sección 5 de la
 * US-022): el texto de `codigo_barras` (p. ej. «GA-LAP-000042»). */
export const TIPOS_DE_CODIGO = ["qr", "code128"];

export const TEXTO_SIN_CAMARA =
  "Esta versión de la app todavía no puede usar la cámara. Escriba el código de la etiqueta a mano; " +
  "la lectura con la cámara llega con la próxima actualización.";
export const TEXTO_SIN_PERMISO_CAMARA =
  "La app no tiene permiso para usar la cámara. Puede darlo en los ajustes del teléfono o escribir el código a mano.";

/** Lo que muestra el escáner tras leer un código: el resumen del activo
 * (CA-11) con «Ver ficha» y «Registrar mantenimiento». */
function Resultado({ ficha, permisos, onVerFicha, onRegistrar, onOtro }) {
  const activo = ficha?.activo ?? {};
  const puedeRegistrar = permisos.includes("mantenimientos.registrar") && estaOperativo(activo);
  return (
    <View style={estilos.resultado} testID="resultado-escaneo">
      {ficha?.advertencia_lector ? <Alerta tipo="aviso" texto={ficha.advertencia_lector} testID="advertencia-lector" /> : null}
      <View style={estilos.tarjeta} accessible accessibilityLabel={resumenDelEscaneo(activo)} testID="resumen-escaneo">
        <Text style={estilos.codigo}>{activo.codigo_barras}</Text>
        <Text style={estilos.nombre}>{activo.nombre}</Text>
        <EstadoDelActivo activo={activo} />
        <Text style={estilos.dato}>{[activo.tipo_nombre, activo.marca, activo.modelo].filter(Boolean).join(" · ")}</Text>
        <Text style={estilos.dato}>{`Responsable: ${activo.responsables_resumen || "Sin asignar"}`}</Text>
        {lugarDe(activo) ? <Text style={estilos.dato}>{lugarDe(activo)}</Text> : null}
      </View>
      <Boton testID="ver-ficha" titulo="Ver ficha" icono="file-document-outline" onPress={onVerFicha} />
      {puedeRegistrar ? (
        <Boton
          testID="registrar-desde-escaner"
          titulo="Registrar mantenimiento"
          icono="wrench-outline"
          variante="secundario"
          onPress={onRegistrar}
        />
      ) : null}
      <Boton testID="escanear-otro" titulo="Escanear otro" icono="barcode-scan" variante="secundario" onPress={onOtro} />
    </View>
  );
}

/** La cámara con su permiso (solo si el binario trae `expo-camera`). Lee
 * un código a la vez: mientras `activa` es falso no pasa nada más.
 *
 * UX H-06: al volver de los ajustes del teléfono (la app vuelve al frente)
 * se lee otra vez el permiso con el tercer valor del hook
 * (`[permiso, pedir, obtener]` de `createPermissionHook`), sin salir y
 * entrar de nuevo al escáner. */
function VistaDeCamara({ camara, activa, onLeido, pedirAlEntrar = false }) {
  const { CameraView, useCameraPermissions } = camara;
  const [permiso, pedirPermiso, obtenerPermiso] = useCameraPermissions();
  const pedido = useRef(false);

  // Desde la burbuja de «Escanear» (16/11/2026): la cámara arranca sola.
  // Si la persona todavía no decidió el permiso, se le pide de una vez,
  // sin el paso de «Usar la cámara»; una sola vez por entrada.
  useEffect(() => {
    if (!pedirAlEntrar || pedido.current || !permiso || permiso.granted || !permiso.canAskAgain) return;
    pedido.current = true;
    Promise.resolve(pedirPermiso()).catch(() => {});
  }, [pedirAlEntrar, permiso, pedirPermiso]);

  useEffect(() => {
    if (typeof obtenerPermiso !== "function") return undefined;
    const suscripcion = AppState.addEventListener("change", (estado) => {
      if (estado === "active") obtenerPermiso().catch(() => {});
    });
    return () => suscripcion.remove();
  }, [obtenerPermiso]);

  if (!permiso) return <Cargando texto="Preparando la cámara…" />;
  if (!permiso.granted) {
    return (
      <View style={estilos.bloque} testID="sin-permiso-camara">
        <Alerta
          tipo="info"
          texto={permiso.canAskAgain ? "Para leer la etiqueta, la app necesita usar la cámara." : TEXTO_SIN_PERMISO_CAMARA}
        />
        {permiso.canAskAgain ? (
          <Boton testID="dar-permiso" titulo="Usar la cámara" icono="camera-outline" onPress={pedirPermiso} />
        ) : (
          <Boton
            testID="abrir-ajustes"
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
    <View
      style={estilos.marcoCamara}
      accessible
      accessibilityLabel="Cámara. Apunte a la etiqueta del activo: el código se lee solo."
      testID="camara"
    >
      <CameraView
        style={estilos.camara}
        facing="back"
        active={activa}
        barcodeScannerSettings={{ barcodeTypes: TIPOS_DE_CODIGO }}
        onBarcodeScanned={activa ? onLeido : undefined}
      />
    </View>
  );
}

/**
 * «Escanear» (US-022, CA-11 y CA-12): la cámara lee el QR o el Code 128 de
 * la etiqueta y busca el activo con `GET activos/por-codigo/{codigo}/`; si
 * lo encuentra, un resumen con «Ver ficha» y «Registrar mantenimiento». Lee
 * un código a la vez: mientras busca o muestra el resultado, la cámara no
 * vuelve a consultar.
 *
 * Siempre está «Escribir el código a mano», con el mismo endpoint. Sin
 * permiso de cámara se explica y se ofrece abrir los ajustes. Si el binario
 * no trae la cámara (la app de desarrollo sin recompilar), queda solo el
 * ingreso a mano, sin romper la app (`camaraDisponible`).
 *
 * Nada de lo leído se guarda en el teléfono.
 *
 * QA-TECH P2: la cámara solo está montada con la pantalla enfocada, sin
 * modo manual y sin un resultado a la vista; mientras busca queda montada
 * pero inactiva (`active={leyendo}`). Al abrir la ficha o el registro, se
 * desmonta. Al volver con un resultado, se consulta otra vez en silencio
 * (UX H-10).
 *
 * QA-FUNC B5: un código con «.» o «/» no cabe en la ruta `por-codigo/`; se
 * busca con `GET activos/?q=` y, si hay un solo activo, se abre su ficha.
 */
/** `auto`: se llega desde la burbuja de «Escanear» y la cámara arranca sola
 * (pide el permiso de inmediato si hace falta). */
export function Escaner({ auto = false } = {}) {
  const router = useRouter();
  const { usuario } = useSesion();
  const permisos = usuario?.permissions ?? [];
  const camara = camaraDisponible();
  const enfocada = useIsFocused();
  const [manual, setManual] = useState(!camara);
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState({ fase: "leyendo", ficha: null, error: null });
  const ocupado = useRef(false);
  const montado = useMontado();

  const buscar = useCallback(
    async (crudo) => {
      const codigo = codigoLeido(crudo);
      // CA-11: un código a la vez. El candado es síncrono: la cámara manda
      // el mismo código varias veces por segundo.
      if (!codigo || ocupado.current) return;
      ocupado.current = true;
      setEstado({ fase: "buscando", ficha: null, error: null, codigo });
      try {
        if (codigoFueraDeRuta(codigo)) {
          const respuesta = await activosService.listar({ q: codigo });
          if (!montado.current) return;
          const filas = Array.isArray(respuesta?.results) ? respuesta.results : [];
          const activo = activoDelCodigo(filas, codigo);
          if (!activo) {
            const error = filas.length > 1 ? TEXTO_CODIGO_AMBIGUO : TEXTO_CODIGO_NO_ENCONTRADO;
            setEstado({ fase: "error", ficha: null, error, codigo });
            return;
          }
          // Como cualquier código: el resumen con «Ver ficha». El candado
          // sigue puesto hasta «Escanear otro», así una segunda lectura no
          // apila otra ficha (QA-TECH, revalidación de la US-022).
          const ficha = await activosService.historial(activo.id);
          if (!montado.current) return;
          setEstado({ fase: "encontrado", ficha, error: null, codigo });
          anunciar(`Activo encontrado: ${ficha?.activo?.nombre ?? codigo}.`);
          return;
        }
        const ficha = await activosService.porCodigo(codigo);
        if (!montado.current) return;
        setEstado({ fase: "encontrado", ficha, error: null, codigo });
        anunciar(`Activo encontrado: ${ficha?.activo?.nombre ?? codigo}.`);
      } catch (e) {
        if (!montado.current) return;
        // CA-12: el 404 `activo_no_encontrado` trae su propio mensaje.
        setEstado({ fase: "error", ficha: null, error: mensajeDeActivos(e, "No se pudo buscar el activo."), codigo });
      }
    },
    [montado, router],
  );

  // UX H-10: al volver (de la ficha o del registro) con un resultado a la
  // vista, se consulta otra vez en silencio: pudo cambiar de estado.
  const estabaEnfocada = useRef(enfocada);
  useEffect(() => {
    const volvio = enfocada && !estabaEnfocada.current;
    estabaEnfocada.current = enfocada;
    const id = estado.fase === "encontrado" ? estado.ficha?.activo?.id : null;
    if (!volvio || !id) return;
    activosService
      .historial(id)
      .then((ficha) => {
        if (!montado.current) return;
        setEstado((e) =>
          e.fase === "encontrado" && e.ficha?.activo?.id === id
            ? { ...e, ficha: { ...ficha, advertencia_lector: e.ficha.advertencia_lector } }
            : e,
        );
      })
      .catch((e) => {
        if (!montado.current || e?.response?.status !== 404) return;
        setEstado((x) => (x.fase === "encontrado" ? { fase: "error", ficha: null, error: TEXTO_NO_DISPONIBLE, codigo: x.codigo } : x));
      });
  }, [enfocada, estado, montado]);

  // UX H-08: «Intentar con otro código» conserva lo escrito a mano, para
  // corregir una letra sin volver a escribirlo todo.
  function otraVez() {
    ocupado.current = false;
    setEstado({ fase: "leyendo", ficha: null, error: null });
  }

  const alLeer = useCallback((lectura) => buscar(lectura?.data), [buscar]);
  const leyendo = estado.fase === "leyendo";
  const conCamara = Boolean(camara) && enfocada && !manual && (leyendo || estado.fase === "buscando");

  return (
    <ScrollView
      style={estilos.pantalla}
      contentContainerStyle={estilos.contenido}
      keyboardShouldPersistTaps="handled"
      testID="escaner"
    >
      {!camara ? <Alerta tipo="info" texto={TEXTO_SIN_CAMARA} testID="sin-camara" /> : null}

      {/* La cámara solo con la pantalla enfocada y sin un resultado a la
          vista; mientras busca, montada pero inactiva. */}
      {conCamara ? <VistaDeCamara camara={camara} activa={leyendo} onLeido={alLeer} pedirAlEntrar={auto} /> : null}

      {estado.fase === "buscando" ? <Cargando texto={`Buscando ${estado.codigo}…`} /> : null}
      {estado.fase === "error" ? (
        <View style={estilos.bloque}>
          <Alerta tipo="mal" texto={estado.error} testID="error-escaneo" />
          <Boton
            testID="escanear-otra-vez"
            titulo={manual ? "Intentar con otro código" : "Escanear otra vez"}
            icono="refresh"
            variante="secundario"
            onPress={otraVez}
          />
        </View>
      ) : null}
      {estado.fase === "encontrado" ? (
        <Resultado
          ficha={estado.ficha}
          permisos={permisos}
          onVerFicha={() => router.push({ pathname: "/activos/[id]", params: { id: String(estado.ficha.activo.id) } })}
          onRegistrar={() => router.push(rutaDeRegistrarMantenimiento(estado.ficha.activo))}
          onOtro={otraVez}
        />
      ) : null}

      {manual && leyendo ? (
        <View style={estilos.bloque} testID="ingreso-manual">
          <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
            Código de la etiqueta o número de serie
          </Text>
          <TextInput
            testID="codigo-a-mano"
            value={texto}
            onChangeText={setTexto}
            placeholder="GA-LAP-000042"
            placeholderTextColor={colores.tintaTenue}
            accessibilityLabel="Código de la etiqueta o número de serie"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => buscar(texto)}
            style={estilos.entrada}
          />
          <Boton
            testID="buscar-codigo"
            titulo="Buscar"
            icono="magnify"
            deshabilitado={!codigoLeido(texto)}
            onPress={() => buscar(texto)}
          />
        </View>
      ) : null}

      {camara && leyendo ? (
        <Boton
          testID={manual ? "usar-camara" : "escribir-a-mano"}
          titulo={manual ? "Usar la cámara" : "Escribir el código a mano"}
          icono={manual ? "camera-outline" : "keyboard-outline"}
          variante="secundario"
          onPress={() => setManual((m) => !m)}
        />
      ) : null}
    </ScrollView>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, paddingBottom: 40, gap: 14 },
  bloque: { gap: 10 },
  marcoCamara: { borderRadius: 12, overflow: "hidden", backgroundColor: colores.marcaNegro, aspectRatio: 3 / 4, maxHeight: 460 },
  camara: { flex: 1 },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  entrada: CONTROLES.entrada,
  resultado: { gap: 10 },
  tarjeta: {
    gap: 4,
    padding: 14,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  codigo: { fontSize: 14, fontWeight: "600", color: colores.tintaSuave },
  nombre: { fontSize: 18, fontWeight: "700", color: colores.titulo },
  dato: { fontSize: 15, color: colores.tinta },
});
