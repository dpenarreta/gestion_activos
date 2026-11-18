import * as Linking from "expo-linking";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { anunciar } from "../../accesibilidad/anunciar";
import { borrarArchivo } from "../../adjuntos/descargas";
import { descartarTemporal, tamanoLegible } from "../../adjuntos/seleccion";
import { mensajeDeError } from "../../api/errores";
import { chatService } from "../../api/servicios";
import {
  descargarArchivoDelChat,
  elegirArchivoParaElChat,
  elegirImagenParaElChat,
  guardarArchivoEnElTelefono,
  TEXTO_ARCHIVO_GRANDE,
  tomarFotoParaElChat,
} from "../../chat/adjunto";
import { registrarConversacionAbierta } from "../../chat/avisoEnPrimerPlano";
import { PISTA_CONTACTO, useAbrirContacto } from "../../chat/contacto";
import { useChat, useChatVisible } from "../../chat/ChatContext";
import {
  claveDeDia,
  esGrupal,
  estadoDeLectura,
  etiquetaDeDia,
  horaDeMensaje,
  NOMBRE_DE_TIPO,
  textoLeidoEn,
} from "../../chat/formato";
import { useAppActiva, useEnFoco, usePresencia } from "../../chat/usePresencia";
import { Alerta, Boton, BotonIcono, Cargando, ErrorConReintento } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { VisorDeImagen } from "../../componentes/VisorDeImagen";
import { useApoyoDeLaBurbuja, useRellenoDeLaBurbuja } from "../../navegacion/BurbujaDeSoporte";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import { useContador } from "../../notificaciones/ContadorContext";
import { useSesion } from "../../sesion/SesionContext";
import { AREA_TACTIL } from "../../tema/colores";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { aHora } from "../../utils/fechas";
import { useMedianoche } from "../../utils/useMedianoche";
import { AvisoDeEstado, Presencia } from "./piezas";

/**
 * Una conversación (US-011, CA-2, CA-3, CA-6, CA-7, CA-9, CA-11 y CA-14),
 * con el comportamiento de `Conversacion.jsx` de la web:
 *
 * - `FlatList` invertida: lo más nuevo abajo y, al subir, los mensajes
 *   anteriores de a 50 (`?antes=`), también con «Ver mensajes anteriores».
 * - Se marca leída al verla y con cada mensaje ajeno que llega mientras se ve
 *   (`POST …/leer/` con `hasta`): eso apaga su aviso en la campana.
 * - Lo nuevo llega por la consulta periódica del `ChatProvider`; cada mensaje
 *   ajeno se anuncia al lector de pantalla.
 * - Enviar: el mensaje aparece enseguida como «Enviando…»; si falla queda con
 *   «No se envió» y «Reintentar», sin perder el texto ni el archivo. Un
 *   candado síncrono impide el doble envío: el estado tarda un render en
 *   desactivar el botón. Se envía de a uno, para que el orden sea el del
 *   servidor.
 * - Los adjuntos se validan antes de enviar con los límites del servidor. Al
 *   tocar uno recibido se descarga con la sesión; una imagen se ve en la app
 *   y otro archivo se abre con el sistema. Se borra al cerrar el visor y al
 *   salir (LOPDP); al cerrar sesión se borra la carpeta entera.
 * - Mientras tiene el foco, es «la conversación abierta» para no mostrar su
 *   push (CA-11).
 *
 * `empresa`: la de la notificación que la abrió (`X-Empresa` solo en las
 * peticiones de esta pantalla, B3 de la US-009).
 */
export const LARGO_MAXIMO = 4000;
export const REFRESCO_LECTURAS_MS = 10_000;
export const TEXTO_NO_ENCONTRADA =
  "Esta conversación no existe o usted ya no participa en ella. Puede que sea de otra empresa: cámbiela en «Cuenta».";
export const TEXTO_NO_SE_ENVIO = "No se envió";
/** Un fallo de red o de tiempo: el servidor pudo haberlo guardado (B2). */
export const TEXTO_SIN_CONFIRMAR = "Sin confirmar";
// R-04: un aviso, no un error; dice qué esperar y qué hacer.
export const TEXTO_PUEDE_HABERSE_ENVIADO =
  "Puede que ya se haya enviado. Espere unos segundos: si llegó, este aviso desaparece solo; si no, reintente.";
/** Margen para el reloj del teléfono frente al del servidor al reconocer un
 * mensaje propio que llegó aunque el envío pareció fallar (B2). */
export const MARGEN_RECONOCER_MS = 2 * 60_000;
/** A partir de esta distancia del final se ofrece «Ir al último mensaje»
 * (N-04). */
export const DISTANCIA_LEJOS = 240;
/** «Ir al último mensaje» flota a esta distancia de la fila de escribir. */
export const DISTANCIA_IR_AL_ULTIMO = 12;
export const TEXTO_SIN_FECHA = "Sin fecha";
export const TEXTO_SIN_MENSAJES = "Todavía no hay mensajes. ¡Escriba el primero!";
/** US-024 (UX H-01): lo que se encuentra en «Información del grupo». */
export const PISTA_INFORMACION = "Abre los participantes y lo que puede hacer con el grupo";

let siguienteClave = 1;

function textoDeAnuncio(mensaje) {
  const autor = mensaje.autor?.nombre ?? "Alguien";
  const contenido = mensaje.texto || (mensaje.archivo ? `envió el archivo ${mensaje.archivo.nombre}` : "");
  return `Mensaje de ${autor}: ${contenido}`;
}

/** El mensaje del servidor al fallar un envío, como la web: primero el del
 * archivo o el del texto, luego el general. `archivo_grande` lleva a quién
 * enviarlo por correo. */
function errorDeEnvio(e) {
  // Sin respuesta (red o tiempo agotado) no se sabe si llegó: se dice, para
  // no reintentar a ciegas y duplicarlo (B2, CA-3).
  if (e?.esDeRed) return { texto: TEXTO_PUEDE_HABERSE_ENVIADO, correos: [], sinConfirmar: true };
  const detalle = e?.response?.data?.error;
  if (detalle?.code === "archivo_grande") {
    const correos = Array.isArray(detalle.details?.correos) ? detalle.details.correos : [];
    return { texto: TEXTO_ARCHIVO_GRANDE, correos };
  }
  const campos = detalle?.details ?? {};
  const primero = (valor) => (Array.isArray(valor) ? valor[0] : typeof valor === "string" ? valor : null);
  const texto =
    primero(campos.archivo) ||
    primero(campos.texto) ||
    (detalle?.message && detalle.message !== "Error en la solicitud." ? detalle.message : null) ||
    mensajeDeError(e, "No se pudo enviar el mensaje.");
  return { texto, correos: [] };
}

/** El autor de un mensaje, para saber si cambia respecto del anterior. */
function quienEscribio(mensaje) {
  return mensaje.propio ? "propio" : String(mensaje.autor?.id ?? mensaje.autor?.nombre ?? "");
}

/**
 * Los elementos de la lista, del más antiguo al más nuevo, con un separador
 * antes del primer mensaje de cada día (auditoría UX, H-07) y, en un grupo,
 * el autor solo cuando cambia respecto del anterior; se repite en cada día
 * (H-13). Lo pendiente se está enviando ahora: va bajo «Hoy».
 */
export function elementosDeLaConversacion(mensajes, pendientes = [], grupal = false, ahora = new Date()) {
  const elementos = [];
  const hoy = claveDeDia(ahora);
  let dia = null;
  let autor = null;
  for (const m of mensajes) {
    // Un día «futuro» (el reloj del teléfono atrasado) es hoy: un solo
    // separador «Hoy» (B4). Sin fecha válida, «Sin fecha» (B1).
    let suDia = claveDeDia(m.fecha);
    if (suDia && suDia > hoy) suDia = hoy;
    if (suDia !== dia) {
      dia = suDia;
      autor = null;
      elementos.push({
        clave: `dia-${suDia || `sin-fecha-${m.id}`}`,
        dia: suDia === hoy ? "Hoy" : etiquetaDeDia(m.fecha, ahora) || TEXTO_SIN_FECHA,
      });
    }
    const quien = quienEscribio(m);
    elementos.push({ clave: `m-${m.id}`, mensaje: m, conAutor: grupal && quien !== autor });
    autor = quien;
  }
  if (pendientes.length > 0) {
    if (dia !== hoy) elementos.push({ clave: `dia-${hoy}`, dia: "Hoy" });
    for (const p of pendientes) elementos.push({ clave: p.clave, pendiente: p });
  }
  return elementos;
}

/**
 * B2 (CA-3, decisión del Tech Lead: solo en la app): si se perdió la
 * respuesta de un envío, el mensaje puede llegar después por el sondeo o la
 * recarga. Un pendiente (enviando o con error) y un mensaje coinciden si el
 * mensaje es propio, tiene el mismo texto y el mismo archivo (o ninguno), es
 * posterior al último que se conocía al escribirlo y su fecha no es anterior
 * al inicio del envío menos `MARGEN_RECONOCER_MS`. Cada mensaje reconoce a
 * un solo pendiente. Devuelve las claves de los pendientes reconocidos.
 */
export function pendientesReconocidos(pendientes, mensajes) {
  const usados = new Set();
  const reconocidos = [];
  for (const p of pendientes) {
    // Un rechazo del servidor es definitivo: ese no llegó (P3-2). Solo los
    // que se envían o están «Sin confirmar».
    if (p.estado === "fallido" && !p.error?.sinConfirmar) continue;
    const encontrado = mensajes.find(
      (m) =>
        !usados.has(m.id) &&
        m.propio &&
        Number(m.id) > (p.ultimoConocido ?? 0) &&
        (m.texto ?? "").trim() === (p.texto ?? "").trim() &&
        (m.archivo?.nombre ?? null) === (p.archivo?.name ?? null) &&
        (() => {
          const fecha = new Date(m.fecha).getTime();
          return Number.isNaN(fecha) || fecha >= p.inicio - MARGEN_RECONOCER_MS;
        })(),
    );
    if (encontrado) {
      usados.add(encontrado.id);
      reconocidos.push(p.clave);
    }
  }
  return reconocidos;
}

/** Si dos listas de lecturas dicen lo mismo: el refresco de cada 10 s no
 * vuelve a dibujar las burbujas si nadie leyó nada nuevo (P2-2). */
export function mismasLecturas(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every(
    (l, i) => l.id === b[i].id && l.ultimo_leido === b[i].ultimo_leido && l.leido_en === b[i].leido_en,
  );
}

const claveDeElemento = (e) => e.clave;

function unir(previos, nuevos) {
  const vistos = new Set(previos.map((m) => m.id));
  const agregados = nuevos.filter((m) => !vistos.has(m.id));
  if (agregados.length === 0) return previos;
  return [...previos, ...agregados].sort((a, b) => a.id - b.id);
}

export function Conversacion({ id, empresa = null }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  useChatVisible();
  const router = useRouter();
  const navegacion = useNavigation();
  const { conversaciones, escucharMensajes, marcarLeida, noLeidos } = useChat();
  const { recargar: recargarContador } = useContador();
  const { versionEmpresa } = useSesion();
  const alturaCabecera = useAlturaCabecera();
  const margenes = useSafeAreaInsets?.() ?? { bottom: 0 };
  const appActiva = useAppActiva();
  const enFoco = useEnFoco();
  const visible = appActiva && enFoco;
  const opcionesEmpresa = useMemo(() => (empresa ? { empresa } : {}), [empresa]);

  const deLaLista = conversaciones.find((c) => String(c.id) === String(id));
  const [detalle, setDetalle] = useState(null);
  const conversacion = deLaLista ?? detalle;
  // Mientras no se sabe qué conversación es (B5), no se trata como grupo.
  const grupal = conversacion ? esGrupal(conversacion) : false;
  const contactoId = !grupal ? (conversacion?.otro?.id ?? null) : null;
  const nombre = conversacion?.nombre ?? "Conversación";

  const [estado, setEstado] = useState("cargando");
  const [errorCarga, setErrorCarga] = useState(null);
  const [noEncontrada, setNoEncontrada] = useState(false);
  const [mensajes, setMensajes] = useState([]);
  const [hayMas, setHayMas] = useState(false);
  const [anteriores, setAnteriores] = useState({ cargando: false, error: null });
  const [lecturas, setLecturas] = useState([]);
  const [pendientes, setPendientes] = useState([]);
  const [texto, setTexto] = useState("");
  const [adjunto, setAdjunto] = useState(null);
  const [opcionesAdjunto, setOpcionesAdjunto] = useState(false);
  const [errorAdjunto, setErrorAdjunto] = useState(null);
  const [avisos, setAvisos] = useState([]);
  const [enviandoAlgo, setEnviandoAlgo] = useState(false);
  const [archivoAbierto, setArchivoAbierto] = useState({ cargando: null, error: null, imagen: null, nombre: "" });
  const [lecturasDe, setLecturasDe] = useState(null);
  const [tecladoVisible, setTecladoVisible] = useState(false);
  // N-04: lejos del último mensaje se ofrece volver, con lo nuevo sin ver.
  const [lejos, setLejos] = useState(false);
  const [nuevosSinVer, setNuevosSinVer] = useState(0);
  // US-029 (CA-3): la burbuja de soporte va sobre la fila de escribir y, si
  // se ve «Ir al último mensaje», también sobre él; nunca los tapa. La lista
  // deja ese espacio bajo el último mensaje (en una lista invertida, arriba).
  const medirRedactar = useApoyoDeLaBurbuja({ extra: lejos ? DISTANCIA_IR_AL_ULTIMO + AREA_TACTIL : 0 });
  const relleno = useRellenoDeLaBurbuja({ margenDelSistema: false });
  const lista = useRef(null);
  const lejosRef = useRef(false);

  const montado = useRef(true);
  const enviando = useRef(false);
  const cargandoAnteriores = useRef(false);
  const descargando = useRef(false);
  const descargados = useRef(new Set());
  // Las imágenes se ven en la conversación desde que llegan (16/11/2026, a
  // pedido del usuario): cada una se descarga una sola vez con la sesión (a lo
  // más 3 a la vez) y la usan la miniatura y el visor. Se borran al salir de
  // la conversación, como todo lo descargado (LOPDP).
  const [miniaturas, setMiniaturas] = useState({});
  const imagenes = useRef(new Map());
  const cola = useRef({ activas: 0, espera: [] });
  const opcionesEmpresaRef = useRef(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const mensajesRef = useRef(mensajes);
  mensajesRef.current = mensajes;
  const pendientesRef = useRef(pendientes);
  pendientesRef.current = pendientes;
  const adjuntoRef = useRef(adjunto);
  adjuntoRef.current = adjunto;
  const ultimoLeidoEnviado = useRef(0);
  const nombreRef = useRef(nombre);
  nombreRef.current = nombre;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      // LOPDP: nada de lo descargado ni de lo elegido sin enviar se queda.
      for (const archivo of descargados.current) borrarArchivo(archivo);
      descargados.current.clear();
      descartarTemporal(adjuntoRef.current?.uri);
      for (const p of pendientesRef.current) descartarTemporal(p.archivo?.uri);
    };
  }, []);

  useEffect(() => {
    // En iOS, «Will»: el margen cambia a la vez que sube el teclado (N-11).
    const enIos = Platform.OS === "ios";
    const mostrar = Keyboard.addListener(enIos ? "keyboardWillShow" : "keyboardDidShow", () => setTecladoVisible(true));
    const ocultar = Keyboard.addListener(enIos ? "keyboardWillHide" : "keyboardDidHide", () => setTecladoVisible(false));
    return () => {
      mostrar.remove();
      ocultar.remove();
    };
  }, []);

  // En un grupo, «Participantes» va en la cabecera, como un ícono (auditoría
  // UX, H-12); la línea «Grupo · N participantes» se queda en la pantalla.
  // US-024 (UX H-01): en un grupo o un grupo por área es «Información del
  // grupo», donde se edita y se sale; la línea también la abre.
  const esGrupo = conversacion?.tipo === "grupo" || conversacion?.tipo === "area";
  const abrirInformacion = useCallback(() => {
    const params = { id: String(id) };
    if (empresa) params.empresa = empresa;
    if (esGrupo) params.grupo = "1";
    router.push({ pathname: "/chat/participantes/[id]", params });
  }, [router, id, empresa, esGrupo]);

  // US-031 (CA-2, CA-4): la tarjeta de la otra persona, con la empresa del
  // chat; la abren el ícono de la derecha y el título.
  const abrirContacto = useAbrirContacto();
  const verContacto = useCallback(() => abrirContacto(contactoId, empresa), [abrirContacto, contactoId, empresa]);

  useEffect(() => {
    // US-031 (CA-2, 18/11/2026, a pedido del usuario): el título también se
    // toca. En un directo abre la tarjeta; en un grupo (y en el canal
    // general), lo mismo que su ícono. Mientras no se sabe qué conversación
    // es (B5), el título es solo texto.
    const accionDelTitulo = conversacion?.tipo && grupal ? abrirInformacion : contactoId ? verContacto : null;
    navegacion?.setOptions?.({
      title: nombre,
      headerTitle: accionDelTitulo
        ? ({ tintColor }) => (
            <Pressable
              testID="titulo-conversacion"
              onPress={accionDelTitulo}
              accessibilityRole="button"
              accessibilityLabel={
                grupal ? (esGrupo ? `Información de ${nombre}` : `Ver los participantes de ${nombre}`) : `Ver el contacto de ${nombre}`
              }
              accessibilityHint={grupal ? (esGrupo ? PISTA_INFORMACION : "Abre la lista de participantes") : PISTA_CONTACTO}
              hitSlop={4}
              style={({ pressed }) => [estilos.titulo, pressed && estilos.tituloPresionado]}
            >
              {/* Con la letra al 200 % el nombre crece hasta 1,5 veces: más
                  no cabe en la cabecera (QA US-031, P3). */}
              <Text
                style={[estilos.tituloTexto, tintColor ? { color: tintColor } : null]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.5}
              >
                {nombre}
              </Text>
            </Pressable>
          )
        : undefined,
      headerRight:
        conversacion?.tipo && grupal
          ? () => (
              <BotonIcono
                testID="ver-participantes"
                icono={esGrupo ? "information-outline" : "account-group-outline"}
                variante="oscuro"
                etiqueta={esGrupo ? `Información de ${nombre}` : `Ver los participantes de ${nombre}`}
                pista={esGrupo ? PISTA_INFORMACION : undefined}
                onPress={abrirInformacion}
              />
            )
          : contactoId
            ? // En un directo, la ficha de contacto de la otra persona
              // (16/11/2026, a pedido del usuario).
              () => (
                <BotonIcono
                  testID="ver-contacto"
                  icono="card-account-details-outline"
                  variante="oscuro"
                  etiqueta={`Ver el contacto de ${nombre}`}
                  pista={PISTA_CONTACTO}
                  onPress={verContacto}
                />
              )
            : undefined,
    });
  }, [navegacion, nombre, grupal, conversacion?.tipo, contactoId, esGrupo, abrirInformacion, verContacto, estilos]);

  // CA-11: mientras tiene el foco, su push no se muestra.
  useFocusEffect(useCallback(() => registrarConversacionAbierta(id, empresa), [id, empresa]));

  /** Marca leído hasta el último mensaje que se ve (o `hasta`, el de uno
   * recién llegado que todavía no se pintó), si hay algo nuevo. */
  const leer = useCallback(
    (forzar = false, hasta = 0) => {
      if (!visibleRef.current) return;
      const lista = mensajesRef.current;
      const ultimo = Math.max(lista.length ? lista[lista.length - 1].id : 0, Number(hasta) || 0);
      if (!forzar && ultimo && ultimo <= ultimoLeidoEnviado.current) return;
      ultimoLeidoEnviado.current = Math.max(ultimoLeidoEnviado.current, ultimo);
      marcarLeida(id);
      chatService
        .leer(id, ultimo || undefined, opcionesEmpresa)
        .then(() => recargarContador())
        .catch(() => {
          // Se reintenta con el próximo mensaje.
          ultimoLeidoEnviado.current = 0;
        });
    },
    [id, marcarLeida, opcionesEmpresa, recargarContador],
  );

  const pedirLecturas = useCallback(() => {
    chatService
      .lecturas(id, opcionesEmpresa)
      .then((datos) => {
        if (montado.current && Array.isArray(datos)) setLecturas((actual) => (mismasLecturas(actual, datos) ? actual : datos));
      })
      .catch(() => {});
  }, [id, opcionesEmpresa]);

  const cargar = useCallback(async () => {
    setEstado("cargando");
    setErrorCarga(null);
    setNoEncontrada(false);
    ultimoLeidoEnviado.current = 0;
    try {
      const datos = await chatService.mensajes(id, opcionesEmpresa);
      if (!montado.current) return;
      const recibidos = Array.isArray(datos?.mensajes) ? datos.mensajes : [];
      setMensajes(recibidos);
      setHayMas(Boolean(datos?.hay_mas));
      const nuevasLecturas = Array.isArray(datos?.lecturas) ? datos.lecturas : [];
      setLecturas((actual) => (mismasLecturas(actual, nuevasLecturas) ? actual : nuevasLecturas));
      reconocerPendientes(recibidos);
      setEstado("listo");
    } catch (e) {
      if (!montado.current) return;
      const status = e?.response?.status;
      if (status === 403 || status === 404) setNoEncontrada(true);
      setErrorCarga(mensajeDeError(e, "No se pudo cargar la conversación."));
      setEstado("error");
    }
  }, [id, opcionesEmpresa]);

  useEffect(() => {
    cargar();
  }, [cargar, versionEmpresa]);

  // Si la conversación no está en la lista (otra empresa, o recién creada),
  // se piden sus datos.
  const tieneDeLaLista = Boolean(deLaLista);
  useEffect(() => {
    if (tieneDeLaLista || estado !== "listo") return undefined;
    let vigente = true;
    chatService
      .conversacion(id, opcionesEmpresa)
      .then((datos) => {
        if (vigente && montado.current && datos) setDetalle(datos);
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [id, opcionesEmpresa, tieneDeLaLista, estado]);

  // Al cargar y al volver a verla, lo que haya queda leído.
  const sinLeerAqui = noLeidos[String(id)] ?? 0;
  useEffect(() => {
    if (estado === "listo" && visible) leer(sinLeerAqui > 0);
  }, [estado, visible, sinLeerAqui, leer]);

  // Lo nuevo de la consulta periódica.
  useEffect(
    () =>
      escucharMensajes(id, (nuevos) => {
        if (!montado.current) return;
        const conocidos = new Set(mensajesRef.current.map((m) => m.id));
        const ajenos = nuevos.filter((m) => !m.propio && !conocidos.has(m.id));
        setMensajes((previos) => unir(previos, nuevos));
        reconocerPendientes(nuevos.filter((m) => !conocidos.has(m.id)));
        if (ajenos.length === 0) return;
        if (lejosRef.current) setNuevosSinVer((n) => n + ajenos.length);
        if (visibleRef.current) {
          // CA-14: cada mensaje recibido se dice; si llegan muchos juntos,
          // cuántos.
          if (ajenos.length <= 3) ajenos.forEach((m) => anunciar(textoDeAnuncio(m)));
          else anunciar(`${ajenos.length} mensajes nuevos en ${nombreRef.current}.`);
          leer(false, Math.max(...ajenos.map((m) => m.id)));
        }
        pedirLecturas();
      }),
    // `reconocerPendientes` solo usa refs y setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, escucharMensajes, leer, pedirLecturas],
  );

  // Quién leyó: cada 10 s mientras se ve, como la web.
  useEffect(() => {
    if (!visible || estado !== "listo") return undefined;
    const intervalo = setInterval(pedirLecturas, REFRESCO_LECTURAS_MS);
    return () => clearInterval(intervalo);
  }, [visible, estado, pedirLecturas]);

  // La presencia del otro, en un directo.
  const otroId = !grupal ? conversacion?.otro?.id : null;
  const presencia = usePresencia(otroId ? [otroId] : []);
  const presenciaDelOtro = otroId ? presencia[String(otroId)] : null;

  /** B2: quita los pendientes que ya están en el servidor. */
  function reconocerPendientes(recibidos) {
    if (!recibidos.length || !pendientesRef.current.length) return;
    const claves = new Set(pendientesReconocidos(pendientesRef.current, recibidos));
    if (claves.size === 0) return;
    for (const p of pendientesRef.current) if (claves.has(p.clave)) descartarTemporal(p.archivo?.uri);
    pendientesRef.current = pendientesRef.current.filter((p) => !claves.has(p.clave));
    setPendientes((lista) => lista.filter((p) => !claves.has(p.clave)));
  }

  /** N-04: la lista va invertida, así que el desplazamiento es la distancia
   * al último mensaje. */
  function alDesplazar(evento) {
    const distancia = evento?.nativeEvent?.contentOffset?.y ?? 0;
    const ahora = distancia > DISTANCIA_LEJOS;
    if (ahora === lejosRef.current) return;
    lejosRef.current = ahora;
    setLejos(ahora);
    if (!ahora) setNuevosSinVer(0);
  }

  function irAlUltimo() {
    lista.current?.scrollToOffset?.({ offset: 0, animated: true });
    lejosRef.current = false;
    setLejos(false);
    setNuevosSinVer(0);
  }

  async function cargarMasAntiguos() {
    if (cargandoAnteriores.current || !hayMas || mensajesRef.current.length === 0) return;
    cargandoAnteriores.current = true;
    setAnteriores({ cargando: true, error: null });
    try {
      const datos = await chatService.mensajes(id, { ...opcionesEmpresa, antes: mensajesRef.current[0].id });
      if (!montado.current) return;
      setMensajes((previos) => unir(previos, Array.isArray(datos?.mensajes) ? datos.mensajes : []));
      setHayMas(Boolean(datos?.hay_mas));
      setAnteriores({ cargando: false, error: null });
    } catch (e) {
      if (montado.current) {
        setAnteriores({ cargando: false, error: mensajeDeError(e, "No se pudieron cargar los mensajes anteriores.") });
      }
    } finally {
      cargandoAnteriores.current = false;
    }
  }

  function actualizarPendiente(clave, cambios) {
    setPendientes((lista) => lista.map((p) => (p.clave === clave ? { ...p, ...cambios } : p)));
  }

  async function enviarPendiente(pendiente) {
    // Candado síncrono: un segundo toque antes del render no envía de nuevo.
    if (enviando.current) return;
    enviando.current = true;
    setEnviandoAlgo(true);
    actualizarPendiente(pendiente.clave, { estado: "enviando", error: null });
    try {
      const enviado = await chatService.enviar(id, pendiente.texto, pendiente.archivo, opcionesEmpresa);
      descartarTemporal(pendiente.archivo?.uri);
      if (!montado.current) return;
      setPendientes((lista) => lista.filter((p) => p.clave !== pendiente.clave));
      if (enviado?.id) setMensajes((previos) => unir(previos, [enviado]));
      // Al enviar, a quiénes no les llegará enseguida (los de un grupo).
      setAvisos(grupal && Array.isArray(enviado?.avisos) ? enviado.avisos : []);
      pedirLecturas();
    } catch (e) {
      if (!montado.current) return;
      // Mientras tanto llegó por el sondeo (B2): ya no hay nada que decir.
      if (!pendientesRef.current.some((p) => p.clave === pendiente.clave)) return;
      const fallo = errorDeEnvio(e);
      actualizarPendiente(pendiente.clave, { estado: "fallido", error: fallo });
      anunciar(`${fallo.sinConfirmar ? TEXTO_SIN_CONFIRMAR : TEXTO_NO_SE_ENVIO}. ${fallo.texto}`);
    } finally {
      enviando.current = false;
      if (montado.current) setEnviandoAlgo(false);
    }
  }

  function alEnviar() {
    if (enviando.current) return;
    const limpio = texto.trim();
    if (!limpio && !adjunto) return;
    if (limpio.length > LARGO_MAXIMO) {
      setErrorAdjunto({ texto: `Como máximo ${LARGO_MAXIMO} caracteres por mensaje.`, correos: [] });
      return;
    }
    const conocidos = mensajesRef.current;
    const pendiente = {
      clave: `pendiente-${siguienteClave++}`,
      texto: limpio,
      archivo: adjunto,
      estado: "enviando",
      error: null,
      // B2: para reconocerlo si llega por el sondeo tras perder la respuesta.
      inicio: Date.now(),
      ultimoConocido: conocidos.length ? Number(conocidos[conocidos.length - 1].id) : 0,
    };
    pendientesRef.current = [...pendientesRef.current, pendiente];
    setPendientes((lista) => [...lista, pendiente]);
    // Al enviar se va siempre al último mensaje (N-04).
    irAlUltimo();
    setTexto("");
    setAdjunto(null);
    setErrorAdjunto(null);
    setOpcionesAdjunto(false);
    enviarPendiente(pendiente);
  }

  function reintentar(clave) {
    const pendiente = pendientesRef.current.find((p) => p.clave === clave);
    if (pendiente) enviarPendiente(pendiente);
  }

  function descartar(clave) {
    const pendiente = pendientesRef.current.find((p) => p.clave === clave);
    descartarTemporal(pendiente?.archivo?.uri);
    setPendientes((lista) => lista.filter((p) => p.clave !== clave));
    anunciar("Mensaje descartado.");
  }

  async function elegirAdjunto(como) {
    setOpcionesAdjunto(false);
    setErrorAdjunto(null);
    let resultado;
    try {
      resultado = await como();
    } catch {
      resultado = { error: "No se pudo abrir el selector. Intente de nuevo." };
    }
    if (!resultado || !montado.current) return;
    if (resultado.error) {
      const correos = !grupal && conversacion?.otro?.correo ? [conversacion.otro.correo] : [];
      setErrorAdjunto({ texto: resultado.error, correos: resultado.error === TEXTO_ARCHIVO_GRANDE ? correos : [] });
      return;
    }
    descartarTemporal(adjuntoRef.current?.uri);
    setAdjunto(resultado.archivo);
    anunciar(`Archivo listo para enviar: ${resultado.archivo.name}.`);
  }

  function quitarAdjunto() {
    descartarTemporal(adjunto?.uri);
    setAdjunto(null);
    setErrorAdjunto(null);
    anunciar("Archivo quitado.");
  }

  /** Corre `tarea` cuando hay lugar: a lo más 3 descargas de imágenes a la vez. */
  function enCola(tarea) {
    return new Promise((resolver, rechazar) => {
      const correr = () => {
        cola.current.activas += 1;
        Promise.resolve()
          .then(tarea)
          .then(resolver, rechazar)
          .finally(() => {
            cola.current.activas -= 1;
            const siguiente = cola.current.espera.shift();
            if (siguiente) siguiente();
          });
      };
      if (cola.current.activas < 3) correr();
      else cola.current.espera.push(correr);
    });
  }

  /** El archivo de una imagen, descargado una sola vez. Si falla, se puede
   * volver a pedir. */
  function obtenerImagen(mensaje) {
    const clave = String(mensaje.id);
    let promesa = imagenes.current.get(clave);
    if (!promesa) {
      promesa = enCola(() => descargarArchivoDelChat(mensaje, opcionesEmpresaRef.current ?? {})).then((archivo) => {
        if (!montado.current) {
          borrarArchivo(archivo);
          throw new Error("Se salió de la conversación.");
        }
        descargados.current.add(archivo);
        return archivo;
      });
      imagenes.current.set(clave, promesa);
      promesa.catch(() => imagenes.current.delete(clave));
    }
    return promesa;
  }

  /** La miniatura de una imagen que se acaba de dibujar. */
  function pedirMiniatura(mensaje) {
    const clave = String(mensaje.id);
    if (imagenes.current.has(clave)) return;
    setMiniaturas((m) => ({ ...m, [clave]: { cargando: true } }));
    obtenerImagen(mensaje).then(
      (archivo) => montado.current && setMiniaturas((m) => ({ ...m, [clave]: { uri: archivo.uri } })),
      () => montado.current && setMiniaturas((m) => ({ ...m, [clave]: { error: true } })),
    );
  }

  async function abrirArchivo(mensaje) {
    if (descargando.current || !mensaje?.archivo) return;
    descargando.current = true;
    const nombreArchivo = mensaje.archivo.nombre;
    setArchivoAbierto({ cargando: mensaje.id, error: null, imagen: null, nombre: nombreArchivo });
    try {
      if (mensaje.archivo.es_imagen) {
        // La misma descarga de su miniatura (si ya llegó, no se repite).
        const imagen = await obtenerImagen(mensaje);
        if (!montado.current) return;
        setMiniaturas((m) => ({ ...m, [String(mensaje.id)]: { uri: imagen.uri } }));
        setArchivoAbierto({ cargando: null, error: null, imagen: imagen.uri, nombre: nombreArchivo, archivo: imagen });
        return;
      }
      const archivo = await descargarArchivoDelChat(mensaje, opcionesEmpresa);
      if (!montado.current) {
        borrarArchivo(archivo);
        return;
      }
      // Otro archivo se guarda en el teléfono, donde la persona elija
      // (16/11/2026, igual que «Descargar» en la web). La copia de la caché
      // se borra enseguida (LOPDP): solo queda la que la persona guardó.
      let guardado = null;
      try {
        guardado = await guardarArchivoEnElTelefono(archivo, nombreArchivo);
      } finally {
        borrarArchivo(archivo);
      }
      if (!montado.current) return;
      setArchivoAbierto({
        cargando: null,
        error: null,
        imagen: null,
        nombre: "",
        guardado: guardado ? { texto: `Se guardó «${nombreArchivo}» en el teléfono.`, clave: Date.now() } : null,
      });
    } catch (e) {
      if (montado.current) {
        setArchivoAbierto({
          cargando: null,
          error: { texto: e?.message || "No se pudo abrir el archivo.", clave: Date.now() },
          imagen: null,
          nombre: "",
        });
      }
    } finally {
      descargando.current = false;
    }
  }

  function cerrarVisor() {
    // La imagen la sigue usando su miniatura: se borra al salir (LOPDP).
    setArchivoAbierto({ cargando: null, error: null, imagen: null, nombre: "" });
  }

  function escribirPorCorreo(correos) {
    const asunto = encodeURIComponent(`Archivo para ${nombre}`);
    Linking.openURL(`mailto:${correos.join(",")}?subject=${asunto}`).catch(() => {});
  }

  // La lista invertida: lo más nuevo primero (abajo en pantalla). Por eso el
  // separador de un día queda en el arreglo después de sus mensajes. `hoy`
  // en las dependencias: al pasar la medianoche, el siguiente render o
  // sondeo corrige «Hoy» y «Ayer» (B4).
  // O3: a las 00:00:05 se vuelve a dibujar aunque no llegue nada.
  const tic = useMedianoche();
  const hoy = claveDeDia(new Date());
  const elementos = useMemo(
    () => elementosDeLaConversacion(mensajes, pendientes, grupal).reverse(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mensajes, pendientes, grupal, hoy, tic],
  );

  // P2-2: las acciones de las burbujas pasan por un ref, así las funciones
  // que reciben no cambian en cada render y `memo` las deja quietas al
  // escribir.
  const acciones = useRef({});
  acciones.current = { abrirArchivo, pedirMiniatura, verLecturas: setLecturasDe, reintentar, descartar, escribirPorCorreo };
  opcionesEmpresaRef.current = opcionesEmpresa;
  const alAbrirArchivo = useCallback((m) => acciones.current.abrirArchivo(m), []);
  const alPedirMiniatura = useCallback((m) => acciones.current.pedirMiniatura(m), []);
  const alVerLecturas = useCallback((m) => acciones.current.verLecturas(m), []);
  const alReintentar = useCallback((clave) => acciones.current.reintentar(clave), []);
  const alDescartar = useCallback((clave) => acciones.current.descartar(clave), []);
  const alCorreo = useCallback((correos) => acciones.current.escribirPorCorreo(correos), []);
  const abriendoId = archivoAbierto.cargando;

  const pintarElemento = useCallback(
    ({ item }) => {
      // B1: por tipo de elemento, no por un valor «verdadero».
      if ("dia" in item) return <SeparadorDeDia texto={item.dia} />;
      if ("mensaje" in item) {
        const propio = Boolean(item.mensaje.propio);
        return (
          <Burbuja
            mensaje={item.mensaje}
            grupal={grupal}
            conAutor={item.conAutor}
            // Solo las propias dicen quién leyó: las ajenas no se vuelven a
            // dibujar cuando cambian las lecturas.
            lecturas={propio ? lecturas : undefined}
            abriendo={abriendoId === item.mensaje.id}
            miniatura={item.mensaje.archivo?.es_imagen ? miniaturas[String(item.mensaje.id)] : undefined}
            onPedirMiniatura={alPedirMiniatura}
            onAbrirArchivo={alAbrirArchivo}
            onVerLecturas={alVerLecturas}
          />
        );
      }
      return (
        <BurbujaPendiente
          pendiente={item.pendiente}
          bloqueado={enviandoAlgo}
          onReintentar={alReintentar}
          onDescartar={alDescartar}
          onCorreo={alCorreo}
        />
      );
    },
    [
      grupal,
      lecturas,
      abriendoId,
      miniaturas,
      enviandoAlgo,
      alAbrirArchivo,
      alPedirMiniatura,
      alVerLecturas,
      alReintentar,
      alDescartar,
      alCorreo,
    ],
  );

  if (estado === "cargando" && mensajes.length === 0) return <Cargando texto="Cargando la conversación…" />;
  if (estado === "error") {
    return (
      <View style={estilos.contenidoError}>
        {noEncontrada ? (
          <>
            <Alerta tipo="mal" texto={TEXTO_NO_ENCONTRADA} />
            <Boton titulo="Volver" icono="arrow-left" variante="secundario" onPress={() => router.back()} />
          </>
        ) : (
          <ErrorConReintento texto={errorCarga} onReintentar={cargar} />
        )}
      </View>
    );
  }

  const puedeEnviar = !enviandoAlgo && (texto.trim().length > 0 || Boolean(adjunto));

  return (
    <KeyboardAvoidingView
      style={estilos.pantalla}
      behavior="padding"
      // La cabecera de la pila queda arriba: el teclado se mide desde ella.
      // En Android (edge-to-edge desde el SDK 53) la ventana ya no se
      // redimensiona sola, así que también hace falta.
      keyboardVerticalOffset={alturaCabecera}
    >
      <View style={estilos.barra}>
        {grupal ? (
          <View style={estilos.barraFila}>
            {/* US-024 (UX H-01): tocar la línea abre lo mismo que el ícono. */}
            <Pressable
              testID="linea-del-grupo"
              onPress={abrirInformacion}
              accessibilityRole="button"
              accessibilityHint={esGrupo ? PISTA_INFORMACION : "Abre la lista de participantes"}
              hitSlop={4}
              style={({ pressed }) => [estilos.lineaDelGrupo, pressed && estilos.lineaPresionada]}
            >
              <Text style={estilos.enlaceTenue}>
                {NOMBRE_DE_TIPO[conversacion?.tipo] ?? "Grupo"}
                {conversacion?.miembros ? ` · ${conversacion.miembros} participantes` : ""}
              </Text>
              <Icono nombre="chevron-right" size={18} color={colores.tintaSuave} />
            </Pressable>
          </View>
        ) : presenciaDelOtro ? (
          <Presencia presencia={presenciaDelOtro} testID="presencia-del-otro" />
        ) : null}
        {presenciaDelOtro?.estado ? (
          <AvisoDeEstado nombre={nombre} estado={presenciaDelOtro.estado} testID="aviso-del-otro" />
        ) : null}
      </View>

      {/* R-01: la lista y «Ir al último mensaje» van en su propia zona; el
          botón flota sobre la lista y nunca sobre la fila de escribir. */}
      <View style={estilos.zonaLista} testID="zona-lista">
        <FlatList
          ref={lista}
          testID="mensajes"
          inverted
          style={estilos.lista}
          contentContainerStyle={[estilos.listaContenido, relleno ? { paddingTop: relleno.paddingBottom } : null]}
          data={elementos}
          extraData={miniaturas}
          keyExtractor={claveDeElemento}
          // N-04: con la persona leyendo más arriba, lo nuevo no la mueve.
          // El mismo umbral que «Ir al último»: sin un tramo en que ni se
          // sigue lo nuevo ni se ofrece volver (P3-1).
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: DISTANCIA_LEJOS }}
          onScroll={alDesplazar}
          scrollEventThrottle={100}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          onEndReached={cargarMasAntiguos}
          onEndReachedThreshold={0.3}
          accessibilityLabel={`Mensajes de ${nombre}`}
          ListEmptyComponent={
            <View style={estilos.vacio}>
              <Text style={estilos.tenueCentro}>{TEXTO_SIN_MENSAJES}</Text>
            </View>
          }
          // En una lista invertida, el pie queda arriba: los anteriores.
          ListFooterComponent={
            anteriores.cargando ? (
              <View style={estilos.anteriores} accessible accessibilityRole="progressbar" accessibilityLabel="Cargando mensajes anteriores…">
                <ActivityIndicator color={colores.primario} />
              </View>
            ) : anteriores.error ? (
              <View style={estilos.anteriores}>
                <ErrorConReintento texto={anteriores.error} onReintentar={cargarMasAntiguos} />
              </View>
            ) : hayMas ? (
              <View style={estilos.anteriores}>
                <Boton
                  testID="ver-anteriores"
                  titulo="Ver mensajes anteriores"
                  icono="history"
                  variante="secundario"
                  onPress={cargarMasAntiguos}
                />
              </View>
            ) : null
          }
          renderItem={pintarElemento}
        />
        {lejos ? (
          <View style={estilos.irAlUltimo}>
            <BotonIcono
              testID="ir-al-ultimo"
              icono="chevron-double-down"
              variante="contorno"
              etiqueta={
                nuevosSinVer > 0
                  ? `Ir al último mensaje. ${nuevosSinVer === 1 ? "1 mensaje nuevo" : `${nuevosSinVer} mensajes nuevos`}`
                  : "Ir al último mensaje"
              }
              onPress={irAlUltimo}
            />
            {nuevosSinVer > 0 ? (
              <View style={estilos.irAlUltimoCuenta} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <Text style={estilos.irAlUltimoTexto}>{nuevosSinVer > 99 ? "99+" : nuevosSinVer}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={[estilos.redactar, { paddingBottom: 8 + (tecladoVisible ? 0 : margenes.bottom) }]} onLayout={medirRedactar}>
        {archivoAbierto.error ? (
          <Alerta tipo="mal" texto={archivoAbierto.error.texto} clave={archivoAbierto.error.clave} />
        ) : null}
        {archivoAbierto.guardado ? (
          <Alerta
            tipo="bien"
            texto={archivoAbierto.guardado.texto}
            clave={archivoAbierto.guardado.clave}
            testID="archivo-guardado"
          />
        ) : null}
        {avisos.map((a) => (
          <AvisoDeEstado key={a.usuario} nombre={a.nombre} estado={a} />
        ))}
        {errorAdjunto ? (
          <View style={estilos.errorAdjunto}>
            <Alerta tipo="aviso" texto={errorAdjunto.texto} testID="error-adjunto" />
            {errorAdjunto.correos?.length ? (
              <Boton
                titulo={`Escribir a ${errorAdjunto.correos.join(", ")}`}
                icono="email-outline"
                variante="secundario"
                onPress={() => escribirPorCorreo(errorAdjunto.correos)}
              />
            ) : null}
          </View>
        ) : null}
        {adjunto ? (
          <View style={estilos.adjunto} testID="adjunto-elegido">
            <Icono nombre={adjunto.type?.startsWith("image/") ? "file-image-outline" : "paperclip"} size={20} color={colores.primario} />
            <Text style={estilos.adjuntoTexto}>
              {adjunto.name}
              {adjunto.size ? ` · ${tamanoLegible(adjunto.size)}` : ""}
            </Text>
            <BotonIcono
              testID="quitar-adjunto"
              icono="close"
              color={colores.tinta}
              etiqueta={`Quitar el archivo ${adjunto.name}`}
              onPress={quitarAdjunto}
            />
          </View>
        ) : null}
        {opcionesAdjunto ? (
          <View style={estilos.opciones} testID="opciones-adjunto">
            <Boton testID="adjuntar-camara" titulo="Tomar foto" icono="camera-outline" variante="secundario" onPress={() => elegirAdjunto(tomarFotoParaElChat)} />
            <Boton testID="adjuntar-galeria" titulo="Elegir imagen" icono="image-outline" variante="secundario" onPress={() => elegirAdjunto(elegirImagenParaElChat)} />
            <Boton testID="adjuntar-archivo" titulo="Elegir archivo" icono="file-document-outline" variante="secundario" onPress={() => elegirAdjunto(elegirArchivoParaElChat)} />
          </View>
        ) : null}
        <View style={estilos.redactarFila}>
          <BotonIcono
            testID="adjuntar"
            icono="paperclip"
            etiqueta="Adjuntar foto o archivo"
            pista="Hasta 10 MB: PDF, imagen, Word o Excel"
            expandido={opcionesAdjunto}
            onPress={() => {
              // N-07: con el teclado arriba, las opciones quedarían tapadas.
              if (!opcionesAdjunto) Keyboard.dismiss();
              setOpcionesAdjunto((v) => !v);
            }}
          />
          <TextInput
            testID="escribir"
            value={texto}
            onChangeText={setTexto}
            multiline
            maxLength={LARGO_MAXIMO}
            placeholder="Escriba un mensaje"
            placeholderTextColor={colores.tintaTenue}
            accessibilityLabel={`Mensaje para ${nombre}`}
            style={estilos.entrada}
          />
          <Pressable
            testID="enviar"
            onPress={alEnviar}
            disabled={!puedeEnviar}
            accessibilityRole="button"
            accessibilityLabel="Enviar"
            accessibilityState={{ disabled: !puedeEnviar, busy: enviandoAlgo }}
            style={({ pressed }) => [estilos.botonEnviar, !puedeEnviar && estilos.inactivo, pressed && estilos.presionado]}
          >
            {enviandoAlgo ? (
              <ActivityIndicator color={colores.sobrePrimario} />
            ) : (
              <Icono nombre="send" size={22} color={colores.sobrePrimario} />
            )}
          </Pressable>
        </View>
      </View>

      <VisorDeImagen
        uri={archivoAbierto.imagen}
        archivo={archivoAbierto.archivo}
        titulo={archivoAbierto.nombre}
        tituloPorDefecto="Imagen del chat"
        etiquetaImagen={`Imagen del chat: ${archivoAbierto.nombre || "imagen"}`}
        onCerrar={cerrarVisor}
        testIDCerrar="cerrar-imagen"
        testIDImagen="imagen-del-chat"
      />
      <ModalLecturas mensaje={lecturasDe} lecturas={lecturas} grupal={grupal} onCerrar={() => setLecturasDe(null)} />
    </KeyboardAvoidingView>
  );
}

/** «Hoy», «Ayer» o la fecha, centrado entre los mensajes (H-07). Es un
 * encabezado: con el lector se salta de día en día. */
export const SeparadorDeDia = memo(function SeparadorDeDia({ texto }) {
  const estilos = useEstilos(fabricaDeEstilos);
  if (!texto) return null;
  return (
    <View style={estilos.separadorDia}>
      <Text style={estilos.separadorDiaTexto} accessibilityRole="header">
        {texto}
      </Text>
    </View>
  );
});

/** Un mensaje del servidor. Los propios dicen si se leyeron; con una
 * pulsación larga (o la acción del lector de pantalla) se ve quién y cuándo
 * (CA-9). Si trae un archivo, al tocarlo se abre. Se ve solo la hora (el día
 * lo dice el separador); la etiqueta accesible lleva día y hora. En un grupo,
 * el autor se ve cuando cambia (`conAutor`), pero siempre se oye. */
export const Burbuja = memo(function Burbuja({
  mensaje,
  grupal,
  conAutor = grupal,
  lecturas,
  abriendo,
  miniatura,
  onPedirMiniatura,
  onAbrirArchivo,
  onVerLecturas,
}) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const propio = Boolean(mensaje.propio);
  const autor = propio ? "Usted" : mensaje.autor?.nombre ?? "Alguien";
  const hora = horaDeMensaje(mensaje.fecha);
  const fecha = new Date(mensaje.fecha);
  const soloHora = Number.isNaN(fecha.getTime()) ? "" : aHora(fecha);
  const lectura = propio ? estadoDeLectura(mensaje, lecturas, grupal) : null;
  const archivo = mensaje.archivo;
  // Una imagen se ve en la burbuja (16/11/2026); si no se pudo descargar,
  // queda la fila con su nombre y «Ver», que lo vuelve a intentar.
  const conMiniatura = Boolean(archivo?.es_imagen) && !miniatura?.error;
  useEffect(() => {
    if (conMiniatura && !miniatura) onPedirMiniatura?.(mensaje);
  }, [conMiniatura, miniatura, mensaje, onPedirMiniatura]);
  const etiqueta = [
    `${autor}, ${hora}`,
    mensaje.texto || null,
    archivo ? `${archivo.es_imagen ? "Imagen" : "Archivo"}: ${archivo.nombre}${archivo.tamano ? `, ${tamanoLegible(archivo.tamano)}` : ""}` : null,
    lectura?.texto ?? null,
  ]
    .filter(Boolean)
    .join(". ");
  // N-05: en Android la pulsación larga no se descubre; un toque en una
  // propia sin archivo también abre «quién leyó» (la larga se mantiene).
  const alTocar = archivo ? () => onAbrirArchivo(mensaje) : lectura ? () => onVerLecturas(mensaje) : undefined;
  const acciones = [
    ...(archivo ? [{ name: "activate", label: `${archivo.es_imagen ? "Abrir" : "Descargar"} ${archivo.nombre}` }] : []),
    ...(!archivo && lectura ? [{ name: "activate", label: "Ver quién lo leyó" }] : []),
    // R-05: sin archivo, «activate» ya dice «Ver quién lo leyó».
    ...(archivo && lectura ? [{ name: "longpress", label: "Ver quién lo leyó" }] : []),
  ];
  const pista = lectura
    ? archivo
      ? "Mantenga pulsado para ver quién lo leyó"
      : "Toque para ver quién lo leyó"
    : undefined;
  return (
    <View style={[estilos.fila, propio && estilos.filaPropia]}>
      <Pressable
        testID={`mensaje-${mensaje.id}`}
        onPress={alTocar}
        onLongPress={lectura ? () => onVerLecturas(mensaje) : undefined}
        accessible
        accessibilityRole={alTocar ? "button" : undefined}
        accessibilityLabel={etiqueta}
        accessibilityHint={pista}
        accessibilityActions={acciones.length ? acciones : undefined}
        onAccessibilityAction={(evento) => {
          const accion = evento.nativeEvent.actionName;
          if (accion === "activate") alTocar?.();
          if (accion === "longpress" && lectura) onVerLecturas(mensaje);
        }}
        style={[estilos.burbuja, propio ? estilos.burbujaPropia : estilos.burbujaAjena]}
      >
        {/* N-08: en un grupo, las propias no dicen «Usted» (se ve por el
            color y el lado); se sigue oyendo en la etiqueta. */}
        {grupal && conAutor && !propio ? <Text style={estilos.autor}>{autor}</Text> : null}
        {mensaje.texto ? (
          // Seleccionable solo si tocar no hace otra cosa (N-05).
          <Text style={[estilos.textoMensaje, propio && estilos.textoPropio]} selectable={!alTocar}>
            {mensaje.texto}
          </Text>
        ) : null}
        {conMiniatura ? (
          <View style={estilos.miniatura} testID={`miniatura-${mensaje.id}`}>
            {miniatura?.uri ? (
              <Image
                testID={`imagen-${mensaje.id}`}
                source={{ uri: miniatura.uri }}
                style={estilos.miniaturaImagen}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : (
              <ActivityIndicator color={propio ? colores.sobreBurbujaPropia : colores.primario} />
            )}
          </View>
        ) : archivo?.es_imagen ? (
          <View style={[estilos.archivo, propio && estilos.archivoPropio]}>
            {abriendo ? (
              <ActivityIndicator color={propio ? colores.sobreBurbujaPropia : colores.primario} />
            ) : (
              <Icono nombre="file-image-outline" size={20} color={propio ? colores.sobreBurbujaPropia : colores.primario} />
            )}
            <Text style={[estilos.archivoTexto, propio && estilos.textoPropio]}>
              {archivo.nombre}
              {archivo.tamano ? ` · ${tamanoLegible(archivo.tamano)}` : ""}
            </Text>
            <Text style={[estilos.archivoAccion, propio && estilos.textoPropio]}>Ver</Text>
          </View>
        ) : archivo ? (
          // Igual que la web (16/11/2026): tarjeta con el nombre y un botón
          // redondo «Descargar». Tocar la tarjeta o el botón lo guarda.
          <View style={estilos.tarjetaArchivo} testID={`archivo-${mensaje.id}`}>
            <Icono nombre="file-document-outline" size={24} color={colores.tintaSuave} />
            <Text style={estilos.tarjetaArchivoNombre}>
              {archivo.nombre}
              {archivo.tamano ? (
                <Text style={estilos.tarjetaArchivoTamano}>{`
${tamanoLegible(archivo.tamano)}`}</Text>
              ) : null}
            </Text>
            <Pressable
              testID={`descargar-${mensaje.id}`}
              onPress={() => onAbrirArchivo(mensaje)}
              disabled={abriendo}
              accessibilityRole="button"
              accessibilityLabel={`Descargar ${archivo.nombre}`}
              hitSlop={6}
              style={({ pressed }) => [estilos.botonDescargar, pressed && estilos.botonDescargarPulsado]}
            >
              {abriendo ? (
                <ActivityIndicator color={colores.marcaNegro} />
              ) : (
                <Icono nombre="download" size={22} color={colores.marcaNegro} />
              )}
            </Pressable>
          </View>
        ) : null}
        <View style={estilos.pieMensaje}>
          <Text style={[estilos.hora, propio && estilos.textoPropioSuave]}>{soloHora}</Text>
          {lectura ? (
            <View style={estilos.lectura}>
              <Icono
                nombre={lectura.leido ? "check-all" : "check"}
                size={14}
                color={lectura.todos ? colores.acento : colores.sobreBurbujaPropia}
              />
              <Text style={[estilos.hora, estilos.textoPropioSuave]}>{lectura.texto}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
});

/** Un mensaje que todavía no está en el servidor: «Enviando…» o «No se
 * envió» con «Reintentar» y «Descartar» (CA-3). */
const BurbujaPendiente = memo(function BurbujaPendiente({ pendiente, bloqueado, onReintentar, onDescartar, onCorreo }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const fallido = pendiente.estado === "fallido";
  const sinConfirmar = fallido && Boolean(pendiente.error?.sinConfirmar);
  const titulo = sinConfirmar ? TEXTO_SIN_CONFIRMAR : TEXTO_NO_SE_ENVIO;
  // R-04: «Sin confirmar» es un aviso (naranja con su ícono), no un error.
  const colorFallo = sinConfirmar ? colores.avisoTexto : colores.malTexto;
  return (
    <View style={[estilos.fila, estilos.filaPropia]}>
      <View
        testID={pendiente.clave}
        style={[
          estilos.burbuja,
          estilos.burbujaPropia,
          fallido && (sinConfirmar ? estilos.burbujaSinConfirmar : estilos.burbujaFallida),
        ]}
      >
        {pendiente.texto ? (
          <Text style={[estilos.textoMensaje, fallido ? null : estilos.textoPropio]}>{pendiente.texto}</Text>
        ) : null}
        {pendiente.archivo ? (
          <View style={estilos.archivo}>
            <Icono nombre="paperclip" size={18} color={fallido ? colorFallo : colores.sobreBurbujaPropia} />
            <Text style={[estilos.archivoTexto, fallido ? null : estilos.textoPropio]}>{pendiente.archivo.name}</Text>
          </View>
        ) : null}
        {fallido ? (
          <View style={estilos.fallo}>
            <View style={estilos.lectura} accessible accessibilityLabel={`${titulo}. ${pendiente.error?.texto ?? ""}`}>
              <Icono nombre={sinConfirmar ? "alert-outline" : "alert-circle-outline"} size={16} color={colorFallo} />
              <Text style={[estilos.falloTexto, sinConfirmar && estilos.avisoTexto]}>
                {titulo}
                {pendiente.error?.texto ? ` · ${pendiente.error.texto}` : ""}
              </Text>
            </View>
            <View style={estilos.accionesFallo}>
              <Boton
                testID={`reintentar-${pendiente.clave}`}
                titulo="Reintentar"
                icono="refresh"
                variante="secundario"
                deshabilitado={bloqueado}
                onPress={() => onReintentar(pendiente.clave)}
              />
              <Boton
                titulo="Descartar"
                icono="delete-outline"
                variante="secundario"
                deshabilitado={bloqueado}
                etiqueta="Descartar este mensaje"
                onPress={() => onDescartar(pendiente.clave)}
              />
              {pendiente.error?.correos?.length ? (
                <Boton
                  titulo="Enviar por correo"
                  icono="email-outline"
                  variante="secundario"
                  onPress={() => onCorreo(pendiente.error.correos)}
                />
              ) : null}
            </View>
          </View>
        ) : (
          <View style={estilos.lectura} accessible accessibilityLabel="Enviando…">
            <ActivityIndicator size="small" color={colores.sobreBurbujaPropia} />
            <Text style={[estilos.hora, estilos.textoPropioSuave]}>Enviando…</Text>
          </View>
        )}
      </View>
    </View>
  );
});

/** Quién leyó un mensaje propio y cuándo (CA-9), como el `title` de la
 * confirmación de lectura de la web. */
export function ModalLecturas({ mensaje, lecturas, grupal, onCerrar }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const lectura = mensaje ? estadoDeLectura(mensaje, lecturas, grupal) : null;
  return (
    <Modal visible={Boolean(mensaje)} animationType="slide" onRequestClose={onCerrar} presentationStyle="pageSheet">
      <SafeAreaView style={estilos.modal}>
        <View style={estilos.modalCabecera}>
          <Text style={estilos.modalTitulo} accessibilityRole="header">
            Quién leyó su mensaje
          </Text>
          <BotonIcono icono="close" etiqueta="Cerrar" variante="contorno" onPress={onCerrar} testID="cerrar-lecturas" />
        </View>
        {mensaje ? (
          <ScrollView contentContainerStyle={estilos.modalContenido}>
            <Text style={estilos.tenue} numberOfLines={3}>
              {mensaje.texto || mensaje.archivo?.nombre || ""}
            </Text>
            <Text style={estilos.subtitulo}>{lectura?.texto ?? "Enviado"}</Text>
            {lectura?.leyeron.length ? (
              <View style={estilos.seccion}>
                <Text style={estilos.subtitulo} accessibilityRole="header">
                  Lo leyeron
                </Text>
                {lectura.leyeron.map((l) => (
                  <View key={l.id} style={estilos.persona} accessible accessibilityLabel={`${l.nombre}. ${textoLeidoEn(l.leido_en)}`}>
                    <Icono nombre="check-all" size={18} color={colores.bienTexto} />
                    <View style={estilos.personaTexto}>
                      <Text style={estilos.personaNombre}>{l.nombre}</Text>
                      <Text style={estilos.tenue}>{textoLeidoEn(l.leido_en)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={estilos.tenue}>Nadie lo ha leído todavía.</Text>
            )}
            {lectura?.pendientes.length ? (
              <View style={estilos.seccion}>
                <Text style={estilos.subtitulo} accessibilityRole="header">
                  Todavía no lo leen
                </Text>
                {lectura.pendientes.map((l) => (
                  <View key={l.id} style={estilos.persona} accessible accessibilityLabel={`${l.nombre}. Todavía no lo lee`}>
                    <Icono nombre="check" size={18} color={colores.tintaTenue} />
                    <Text style={estilos.personaNombre}>{l.nombre}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const fabricaDeEstilos = (colores, CONTROLES) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenidoError: { padding: 16, gap: 12 },
  barra: { paddingHorizontal: 12, paddingTop: 8, gap: 6, backgroundColor: colores.fondo },
  barraFila: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  lineaDelGrupo: { minHeight: AREA_TACTIL, flexDirection: "row", alignItems: "center", gap: 2 },
  lineaPresionada: { opacity: 0.7 },
  // US-031 (CA-2): el título tocable de la cabecera, con su área de 48/44 y
  // el blanco sobre la cabecera negra en los dos modos.
  titulo: { minHeight: AREA_TACTIL, justifyContent: "center", paddingHorizontal: 6, borderRadius: 8, maxWidth: "100%" },
  tituloPresionado: { backgroundColor: colores.presionadoOscuro },
  tituloTexto: { fontSize: 17, fontWeight: "600", color: colores.sobreCabecera },
  enlaceTenue: { fontSize: 14, color: colores.tintaSuave, textDecorationLine: "underline" },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  tenueCentro: { fontSize: 15, color: colores.tintaTenue, textAlign: "center" },
  lista: { flex: 1 },
  listaContenido: { padding: 12, gap: 8, flexGrow: 1 },
  vacio: { flexGrow: 1, justifyContent: "center", padding: 24 },
  anteriores: { paddingVertical: 8, alignItems: "stretch" },
  // El fondo redondeado va en el View: en un Text, iOS no recorta el radio.
  // `tintaSuave` sobre `hundido`: 8,2:1.
  separadorDia: {
    alignSelf: "center",
    marginVertical: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colores.hundido,
  },
  separadorDiaTexto: { fontSize: 13, fontWeight: "600", color: colores.tintaSuave },
  fila: { flexDirection: "row", justifyContent: "flex-start" },
  filaPropia: { justifyContent: "flex-end" },
  burbuja: { maxWidth: "85%", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, gap: 4 },
  // Propios: el negro de la marca con texto blanco (16,7:1); ajenos: blanco
  // con borde. En oscuro (US-026), los propios en #2E2A0C con #F2F2F2
  // (12,9:1) y los ajenos en la superficie oscura.
  burbujaPropia: { backgroundColor: colores.burbujaPropia },
  burbujaAjena: { backgroundColor: colores.superficie, borderWidth: 1, borderColor: colores.borde },
  burbujaFallida: { backgroundColor: colores.malFondo, borderWidth: 1, borderColor: colores.malTexto },
  // `avisoTexto` sobre `avisoFondo`: 4,8:1.
  burbujaSinConfirmar: { backgroundColor: colores.avisoFondo, borderWidth: 1, borderColor: colores.avisoTexto },
  avisoTexto: { color: colores.avisoTexto },
  autor: { fontSize: 13, fontWeight: "600", color: colores.tintaSuave },
  textoMensaje: { fontSize: 16, color: colores.tinta },
  textoPropio: { color: colores.sobreBurbujaPropia },
  // #C8C8C8 sobre #1E1E1E: 10,0:1 (sobre #2E2A0C en oscuro, 8,6:1).
  textoPropioSuave: { color: colores.sobreBurbujaPropiaSuave },
  archivo: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, minHeight: AREA_TACTIL },
  archivoPropio: {},
  // El archivo que no es foto (16/11/2026): tarjeta clara también en las
  // burbujas propias, con el botón amarillo de marca.
  tarjetaArchivo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: AREA_TACTIL + 8,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 6,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  tarjetaArchivoNombre: { flexShrink: 1, flexGrow: 1, fontSize: 15, color: colores.tinta },
  tarjetaArchivoTamano: { fontSize: 12, color: colores.tintaSuave },
  botonDescargar: {
    width: AREA_TACTIL,
    height: AREA_TACTIL,
    borderRadius: AREA_TACTIL / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colores.marcaAmarillo,
  },
  botonDescargarPulsado: { opacity: 0.8 },
  // La imagen ocupa el ancho de la burbuja, en un cuadro de 4:3.
  miniatura: {
    width: 240,
    maxWidth: "100%",
    aspectRatio: 4 / 3,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colores.hundido,
    alignItems: "center",
    justifyContent: "center",
  },
  miniaturaImagen: { width: "100%", height: "100%" },
  archivoTexto: { flexShrink: 1, fontSize: 15, color: colores.tinta },
  archivoAccion: { fontSize: 15, fontWeight: "600", color: colores.enlace, textDecorationLine: "underline" },
  pieMensaje: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "flex-end" },
  hora: { fontSize: 12, color: colores.tintaTenue },
  lectura: { flexDirection: "row", alignItems: "center", gap: 4 },
  fallo: { gap: 8 },
  falloTexto: { flexShrink: 1, fontSize: 14, color: colores.malTexto },
  accionesFallo: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  redactar: {
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colores.borde,
    backgroundColor: colores.superficie,
  },
  redactarFila: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  entrada: {
    ...CONTROLES.entrada,
    flex: 1,
    maxHeight: 140,
    paddingTop: 10,
    paddingBottom: 10,
    textAlignVertical: "top",
  },
  zonaLista: { flex: 1 },
  irAlUltimo: { position: "absolute", right: 16, bottom: DISTANCIA_IR_AL_ULTIMO, zIndex: 1, alignItems: "center" },
  irAlUltimoCuenta: {
    ...CONTROLES.insignia,
    position: "absolute",
    top: -8,
    right: -8,
  },
  irAlUltimoTexto: CONTROLES.insigniaTexto,
  botonEnviar: {
    minWidth: AREA_TACTIL,
    minHeight: AREA_TACTIL,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: colores.primario,
  },
  inactivo: { opacity: 0.5 },
  presionado: { opacity: 0.85 },
  opciones: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  adjunto: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 10,
    borderRadius: 8,
    backgroundColor: colores.hundido,
  },
  adjuntoTexto: { flex: 1, fontSize: 15, color: colores.tinta },
  errorAdjunto: { gap: 8 },
  modal: { flex: 1, backgroundColor: colores.fondo },
  modalCabecera: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  modalTitulo: { flex: 1, fontSize: 18, fontWeight: "700", color: colores.tinta },
  modalContenido: { padding: 16, gap: 12 },
  subtitulo: { fontSize: 16, fontWeight: "700", color: colores.tinta },
  seccion: { gap: 8 },
  persona: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: AREA_TACTIL },
  personaTexto: { flex: 1 },
  personaNombre: { fontSize: 16, color: colores.tinta },
});
