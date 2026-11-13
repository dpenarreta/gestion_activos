import * as Notifications from "expo-notifications";
import { useFocusEffect } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { mensajeDeError } from "../api/errores";
import { chatService } from "../api/servicios";
import { useSesion } from "../sesion/SesionContext";
import { olvidarConversaciones } from "./avisoEnPrimerPlano";

/**
 * El estado del chat para toda la parte autenticada (US-011, 12/11/2026):
 * la lista de conversaciones, lo que falta leer (la insignia de la pestaña) y
 * la consulta periódica de lo nuevo, igual que `ChatContext.jsx` de la web.
 *
 * Sin sockets (decisión de stack): se piden los mensajes nuevos desde el
 * último visto (`/chat/novedades/?desde=`), con los intervalos de la web:
 *
 * - cada `INTERVALO_MS` (4 s) mientras se ve el chat (la pestaña o una
 *   conversación), como la web con la pestaña del navegador a la vista;
 * - cada `INTERVALO_FUERA_DEL_CHAT_MS` (30 s) en el resto de la app, como la
 *   web con la pestaña oculta: la insignia sigue al día y el push ya avisa;
 * - NADA en segundo plano: al pasar a segundo plano se detiene y al volver
 *   consulta enseguida. También se detiene al desmontarse (cierre de sesión).
 *
 * Nunca hay dos consultas a la vez: si una tarda más que el intervalo, el
 * turno siguiente se salta. Al cambiar de empresa (CA-13) se vuelve a
 * empezar con la empresa nueva, y una respuesta de la anterior ya no se usa.
 *
 * Los no leídos salen del servidor: `no_leidos` trae solo las conversaciones
 * con algo sin leer, así que lo que no viene está en cero (la web los mezcla
 * con los anteriores; aquí se reemplazan, para que lo leído en la web se
 * apague también en el teléfono).
 *
 * Los mensajes nuevos se reparten a la conversación abierta
 * (`escucharMensajes`); la lista se vuelve a pedir si llega algo ajeno o de
 * una conversación que no estaba.
 */
export const INTERVALO_MS = 4000;
export const INTERVALO_FUERA_DEL_CHAT_MS = 30000;

const ChatContext = createContext(null);
/** Solo el total sin leer (US-016, QA-TECH): la navegación lo lee sin
 * volver a pintarse con cada cambio de la lista de conversaciones. */
const TotalNoLeidosContext = createContext(0);

function enPrimerPlano(estado) {
  return estado !== "background" && estado !== "inactive";
}

/** `{conversación: n}` con claves de texto y solo números positivos. */
function normalizar(noLeidos) {
  const resultado = {};
  if (!noLeidos || typeof noLeidos !== "object") return resultado;
  for (const [id, n] of Object.entries(noLeidos)) {
    const cantidad = Number(n) || 0;
    if (cantidad > 0) resultado[String(id)] = cantidad;
  }
  return resultado;
}

/** Si dos `{conversación: n}` dicen lo mismo. Con esto un sondeo sin
 * cambios no crea un objeto nuevo y no vuelve a dibujar la pestaña, la
 * lista ni la conversación abierta (QA-TECH, P2-1). */
export function mismosNoLeidos(a, b) {
  if (a === b) return true;
  const claves = Object.keys(a);
  if (claves.length !== Object.keys(b).length) return false;
  return claves.every((clave) => a[clave] === b[clave]);
}

export function ChatProvider({ children }) {
  const { versionEmpresa } = useSesion();
  const [conversaciones, setConversaciones] = useState([]);
  const [estado, setEstado] = useState("cargando");
  const [error, setError] = useState(null);
  const [noLeidos, setNoLeidos] = useState({});
  const cursor = useRef(null);
  const enCurso = useRef(false);
  const ultima = useRef(0);
  const visibles = useRef(0);
  const oyentes = useRef(new Map());
  const conocidas = useRef(new Set());
  // Sube con cada empresa: lo que responda la anterior se descarta.
  const generacion = useRef(0);
  const montado = useRef(true);
  const sondeo = useRef(null);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      olvidarConversaciones();
    };
  }, []);

  const cargarConversaciones = useCallback(async ({ silenciosa = false } = {}) => {
    const numero = generacion.current;
    if (!silenciosa) {
      setEstado((e) => (e === "listo" ? e : "cargando"));
      setError(null);
    }
    try {
      const lista = await chatService.conversaciones();
      if (!montado.current || numero !== generacion.current) return null;
      const filas = Array.isArray(lista) ? lista : [];
      conocidas.current = new Set(filas.map((c) => String(c.id)));
      setConversaciones(filas);
      const deLaLista = normalizar(Object.fromEntries(filas.map((c) => [c.id, c.no_leidos])));
      setNoLeidos((actual) => (mismosNoLeidos(actual, deLaLista) ? actual : deLaLista));
      setEstado("listo");
      setError(null);
      return filas;
    } catch (e) {
      if (!montado.current || numero !== generacion.current) return null;
      // Con la lista ya cargada, un fallo de un refresco no la borra.
      if (!silenciosa) {
        setError(mensajeDeError(e, "No se pudieron cargar las conversaciones."));
        setEstado((actual) => (actual === "listo" ? actual : "error"));
      }
      return null;
    }
  }, []);

  const consultar = useCallback(async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    const numero = generacion.current;
    try {
      const datos = await chatService.novedades(cursor.current);
      if (!montado.current || numero !== generacion.current || !datos) return;
      if (datos.cursor !== undefined && datos.cursor !== null) cursor.current = datos.cursor;
      const delServidor = normalizar(datos.no_leidos);
      setNoLeidos((actual) => (mismosNoLeidos(actual, delServidor) ? actual : delServidor));
      const nuevos = Array.isArray(datos.mensajes) ? datos.mensajes : [];
      if (nuevos.length === 0) return;
      const porConversacion = new Map();
      for (const mensaje of nuevos) {
        const id = String(mensaje.conversacion);
        if (!porConversacion.has(id)) porConversacion.set(id, []);
        porConversacion.get(id).push(mensaje);
      }
      for (const [id, mensajes] of porConversacion) {
        for (const oyente of oyentes.current.get(id) ?? []) {
          try {
            oyente(mensajes);
          } catch {
            // Un oyente que falla no frena a los demás.
          }
        }
      }
      const desconocida = nuevos.some((m) => !conocidas.current.has(String(m.conversacion)));
      if (desconocida || nuevos.some((m) => !m.propio)) cargarConversaciones({ silenciosa: true });
    } catch {
      // Sin red o con el límite de consultas: se intenta en el próximo turno.
    } finally {
      enCurso.current = false;
    }
  }, [cargarConversaciones]);

  /** Consulta ya (al abrir una conversación o al llegar un push del chat). */
  const consultarAhora = useCallback(() => {
    if (!sondeo.current) return;
    ultima.current = Date.now();
    consultar();
  }, [consultar]);

  useEffect(() => {
    generacion.current += 1;
    cursor.current = null;
    enCurso.current = false;
    conocidas.current = new Set();
    setConversaciones([]);
    setNoLeidos({});
    setEstado("cargando");
    cargarConversaciones();

    function turno() {
      const ahora = Date.now();
      const espera = visibles.current > 0 ? INTERVALO_MS : INTERVALO_FUERA_DEL_CHAT_MS;
      if (ahora - ultima.current < espera - 50) return;
      ultima.current = ahora;
      consultar();
    }
    function arrancar() {
      if (sondeo.current) return;
      ultima.current = Date.now();
      consultar();
      sondeo.current = setInterval(turno, INTERVALO_MS);
    }
    function detener() {
      if (sondeo.current) clearInterval(sondeo.current);
      sondeo.current = null;
    }

    if (enPrimerPlano(AppState.currentState)) arrancar();
    const suscripcionApp = AppState.addEventListener("change", (estadoApp) => {
      if (enPrimerPlano(estadoApp)) {
        const estaba = Boolean(sondeo.current);
        arrancar();
        // Al volver del segundo plano, la lista también pudo cambiar.
        if (!estaba) cargarConversaciones({ silenciosa: true });
      } else {
        detener();
      }
    });
    // Un push del chat con la app abierta: lo nuevo se pide enseguida.
    const suscripcionPush = Notifications.addNotificationReceivedListener((notificacion) => {
      if (notificacion?.request?.content?.data?.modulo === "chat") consultarAhora();
    });
    return () => {
      detener();
      generacion.current += 1;
      suscripcionApp.remove();
      suscripcionPush.remove();
    };
  }, [versionEmpresa, cargarConversaciones, consultar, consultarAhora]);

  /** La conversación `id` recibe sus mensajes nuevos. Devuelve con qué dejar
   * de escuchar. */
  const escucharMensajes = useCallback((id, oyente) => {
    const clave = String(id);
    if (!oyentes.current.has(clave)) oyentes.current.set(clave, new Set());
    oyentes.current.get(clave).add(oyente);
    return () => {
      const conjunto = oyentes.current.get(clave);
      conjunto?.delete(oyente);
      if (conjunto && conjunto.size === 0) oyentes.current.delete(clave);
    };
  }, []);

  /** Lo leído en la conversación abierta se apaga sin esperar al servidor. */
  const marcarLeida = useCallback((id) => {
    const clave = String(id);
    setNoLeidos((actual) => {
      if (!actual[clave]) return actual;
      const siguiente = { ...actual };
      delete siguiente[clave];
      return siguiente;
    });
  }, []);

  /** Mientras se ve el chat, el sondeo va cada 4 s. Devuelve con qué
   * dejarlo. */
  const registrarVisible = useCallback(() => {
    visibles.current += 1;
    // Al entrar al chat, si lo último es de hace más de 4 s, se pide ya.
    if (Date.now() - ultima.current >= INTERVALO_MS) consultarAhora();
    return () => {
      visibles.current = Math.max(0, visibles.current - 1);
    };
  }, [consultarAhora]);

  const totalNoLeidos = useMemo(
    () => Object.values(noLeidos).reduce((suma, n) => suma + (Number(n) || 0), 0),
    [noLeidos],
  );

  const valor = useMemo(
    () => ({
      conversaciones,
      estado,
      error,
      noLeidos,
      totalNoLeidos,
      cargarConversaciones,
      consultarAhora,
      escucharMensajes,
      marcarLeida,
      registrarVisible,
    }),
    [
      conversaciones,
      estado,
      error,
      noLeidos,
      totalNoLeidos,
      cargarConversaciones,
      consultarAhora,
      escucharMensajes,
      marcarLeida,
      registrarVisible,
    ],
  );

  return (
    <ChatContext.Provider value={valor}>
      <TotalNoLeidosContext.Provider value={totalNoLeidos}>{children}</TotalNoLeidosContext.Provider>
    </ChatContext.Provider>
  );
}

const SIN_CHAT = {
  conversaciones: [],
  estado: "cargando",
  error: null,
  noLeidos: {},
  totalNoLeidos: 0,
  cargarConversaciones: async () => null,
  consultarAhora: () => {},
  escucharMensajes: () => () => {},
  marcarLeida: () => {},
  registrarVisible: () => () => {},
};

export function useChat() {
  return useContext(ChatContext) ?? SIN_CHAT;
}

/** El total de mensajes sin leer, sin el resto del chat. */
export function useTotalNoLeidos() {
  return useContext(TotalNoLeidosContext);
}

/** La pantalla que lo usa cuenta como «viendo el chat» mientras tiene el
 * foco: el sondeo va cada 4 s. */
export function useChatVisible() {
  const { registrarVisible } = useChat();
  useFocusEffect(useCallback(() => registrarVisible(), [registrarVisible]));
}
