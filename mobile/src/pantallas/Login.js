import { useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { anunciar } from "../accesibilidad/anunciar";
import { mensajeDeError } from "../api/errores";
import { Alerta, Boton } from "../componentes/comunes";
import { Icono } from "../componentes/Icono";
import { abrirEnNavegador, urlWeb } from "../navegador/enlaceWeb";
import { useSesion } from "../sesion/SesionContext";
import { AREA_TACTIL, colores } from "../tema/colores";
import { crearEstilos } from "../tema/tipografia";

const LOGOTIPO = require("../../assets/marca/laarcourier-positivo.png");
/** Proporción del logotipo LAARCOURIER (709 × 118): nunca se deforma. */
const PROPORCION_LOGOTIPO = 709 / 118;
/** El Brand Book pide al menos 3 cm de ancho (~113 px). */
const ANCHO_MINIMO_LOGOTIPO = 113;

export const FALTA_USUARIO = "Escriba su usuario o correo.";
export const FALTA_CONTRASENA = "Escriba su contraseña.";

/** La etiqueta del campo con su error: la pista (`accessibilityHint`) se
 * lee tarde o no se lee según la configuración del lector, y el error tiene
 * que oírse al llegar al campo (auditoría de QA-UX, 12/11/2026). */
export function etiquetaConError(etiqueta, error) {
  return error ? `${etiqueta}. Error: ${error}` : etiqueta;
}

/** Un campo con su etiqueta y, si hay, su error debajo: el borde cambia y el
 * lector de pantalla oye el error junto con el nombre del campo. */
function Campo({ etiqueta, error, children, id }) {
  return (
    <View style={estilos.campo}>
      <Text style={estilos.etiqueta} nativeID={`etiqueta-${id}`}>
        {etiqueta}
      </Text>
      {children}
      {error ? (
        <View style={estilos.errorCampo}>
          <Icono nombre="alert-circle-outline" size={18} color={colores.malTexto} />
          <Text style={estilos.errorCampoTexto} nativeID={`error-${id}`}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Inicio de sesión (CA-1 y CA-2): los mismos textos que la web. El error que
 * se muestra es `error.message` del contrato (sin detalles técnicos) y el
 * botón no admite un segundo envío mientras el primero no termina: el estado
 * de React tarda un render en deshabilitarlo, así que además hay un candado
 * síncrono (`enviando`).
 */
export function Login() {
  const { iniciarSesion, aviso } = useSesion();
  const { width } = useWindowDimensions();
  // Hasta 260 pt y nunca por debajo del mínimo de la marca.
  const anchoLogotipo = Math.max(ANCHO_MINIMO_LOGOTIPO, Math.min(260, (width || 360) - 96));
  const [identificador, setIdentificador] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState({});
  const enviando = useRef(false);
  const campoUsuario = useRef(null);
  const campoContrasena = useRef(null);

  async function entrar() {
    if (enviando.current) return;
    const faltan = {};
    if (!identificador.trim()) faltan.usuario = FALTA_USUARIO;
    if (!contrasena) faltan.contrasena = FALTA_CONTRASENA;
    setErrores(faltan);
    if (faltan.usuario || faltan.contrasena) {
      anunciar(Object.values(faltan).join(" "));
      (faltan.usuario ? campoUsuario : campoContrasena).current?.focus?.();
      return;
    }
    enviando.current = true;
    setCargando(true);
    setError(null);
    try {
      await iniciarSesion(identificador, contrasena);
      // Al entrar, el guard de la navegación lleva al Inicio y esta pantalla
      // se desmonta: no se toca más el estado.
    } catch (e) {
      setError(mensajeDeError(e, "No se pudo iniciar sesión. Intente de nuevo."));
      setCargando(false);
      enviando.current = false;
    }
  }

  // Los manejadores no devuelven la promesa: el envío sigue solo y el
  // candado de arriba evita el segundo.
  function enviar() {
    entrar();
  }

  function cambiarUsuario(texto) {
    setIdentificador(texto);
    if (errores.usuario) setErrores((e) => ({ ...e, usuario: undefined }));
  }

  function cambiarContrasena(texto) {
    setContrasena(texto);
    if (errores.contrasena) setErrores((e) => ({ ...e, contrasena: undefined }));
  }

  return (
    <SafeAreaView style={estilos.pantalla}>
      {/* «padding» en las dos plataformas: con el teclado abierto el botón
          «Entrar» seguía tapado en Android (revisión de QA-UX). */}
      <KeyboardAvoidingView style={estilos.flex} behavior="padding">
        <ScrollView contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
          <View style={estilos.marca}>
            {/* Logotipo LAARCOURIER en positivo sobre el fondo claro, con su
                área de protección (el `padding` del contenedor). El ícono LCE
                no va junto a él (Brand Book 2026). */}
            <View style={estilos.areaLogotipo}>
              <Image
                testID="logotipo-laarcourier"
                source={LOGOTIPO}
                style={{ width: anchoLogotipo, height: anchoLogotipo / PROPORCION_LOGOTIPO }}
                resizeMode="contain"
                accessible
                accessibilityRole="image"
                accessibilityLabel="LAARCOURIER"
              />
            </View>
            <Text style={estilos.nombreApp} accessibilityRole="header">
              Intranet LCE
            </Text>
            <Text style={estilos.titulo}>Acceso al sistema</Text>
            <Text style={estilos.subtitulo}>Ingrese con su usuario corporativo.</Text>
          </View>

          {aviso && !error && <Alerta texto={aviso} tipo="aviso" />}
          {error && <Alerta texto={error} tipo="mal" />}

          <Campo etiqueta="Usuario o correo" error={errores.usuario} id="usuario">
            <TextInput
              ref={campoUsuario}
              testID="campo-usuario"
              style={[estilos.entrada, errores.usuario && estilos.entradaInvalida]}
              value={identificador}
              onChangeText={cambiarUsuario}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              returnKeyType="next"
              onSubmitEditing={() => campoContrasena.current?.focus()}
              accessibilityLabel={etiquetaConError("Usuario o correo", errores.usuario)}
              aria-invalid={Boolean(errores.usuario)}
              editable={!cargando}
            />
          </Campo>

          <Campo etiqueta="Contraseña" error={errores.contrasena} id="contrasena">
            <View style={estilos.filaContrasena}>
              <TextInput
                ref={campoContrasena}
                testID="campo-contrasena"
                style={[estilos.entrada, estilos.flex, errores.contrasena && estilos.entradaInvalida]}
                value={contrasena}
                onChangeText={cambiarContrasena}
                secureTextEntry={!mostrar}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={enviar}
                accessibilityLabel={etiquetaConError("Contraseña", errores.contrasena)}
                aria-invalid={Boolean(errores.contrasena)}
                editable={!cargando}
              />
              <Pressable
                testID="mostrar-contrasena"
                onPress={() => setMostrar((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={mostrar ? "Ocultar contraseña" : "Mostrar contraseña"}
                style={estilos.botonOjo}
                hitSlop={4}
              >
                <Icono nombre={mostrar ? "eye-off-outline" : "eye-outline"} size={24} color={colores.tintaSuave} />
              </Pressable>
            </View>
          </Campo>

          <Boton testID="boton-entrar" titulo="Entrar" onPress={enviar} cargando={cargando} />

          <Pressable
            onPress={() => abrirEnNavegador(urlWeb("/forgot-password"))}
            accessibilityRole="link"
            accessibilityHint="Se abre en el navegador"
            style={estilos.enlace}
          >
            <Text testID="enlace-olvido-texto" style={estilos.enlaceTexto}>
              ¿Olvidó su contraseña?
            </Text>
            <Icono nombre="open-in-new" size={18} color={colores.primario} />
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const estilos = crearEstilos({
  flex: { flex: 1 },
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 16 },
  marca: { gap: 4, marginBottom: 8 },
  areaLogotipo: { alignItems: "center", paddingVertical: 24, paddingHorizontal: 24 },
  nombreApp: { fontSize: 26, fontWeight: "700", color: colores.titulo, textAlign: "center" },
  titulo: { fontSize: 20, fontWeight: "600", color: colores.tinta, textAlign: "center" },
  subtitulo: { fontSize: 16, color: colores.tintaSuave, textAlign: "center" },
  campo: { gap: 6 },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  entrada: {
    minHeight: AREA_TACTIL,
    borderWidth: 1,
    borderColor: colores.bordeControl,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colores.tinta,
    backgroundColor: colores.superficie,
  },
  entradaInvalida: { borderColor: colores.malTexto, borderWidth: 2 },
  errorCampo: { flexDirection: "row", alignItems: "center", gap: 6 },
  errorCampoTexto: { flex: 1, fontSize: 14, color: colores.malTexto },
  filaContrasena: { flexDirection: "row", alignItems: "center", gap: 8 },
  botonOjo: {
    minWidth: AREA_TACTIL,
    minHeight: AREA_TACTIL,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  // El texto nunca se corta: puede encoger y bajar de línea (letra al 200 %
  // o la medida hecha antes de cargar Poppins, revisión del 12/11/2026).
  enlace: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    gap: 6,
  },
  enlaceTexto: {
    color: colores.enlace,
    fontSize: 16,
    textDecorationLine: "underline",
    flexShrink: 1,
    textAlign: "center",
  },
});
