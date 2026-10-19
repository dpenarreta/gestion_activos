import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { chatService } from "../../../api/chatService";

/**
 * El estado del chat, compartido por la barra acoplada abajo y la página
 * `/admin/chat`: las conversaciones, los mensajes ya cargados, las pestañas
 * abiertas y lo que falta leer.
 *
 * No hay sockets (decisión de stack): cada 4 segundos se piden los mensajes
 * nuevos desde el último que se vio, así que uno tarda como mucho unos 5
 * segundos en aparecer. Cuando llega un mensaje de una conversación que no
 * está abierta, su pestaña aparece minimizada, con la conversación cerrada.
 */

export const INTERVALO_MS = 4000;
const CLAVE_VENTANAS = "chat.ventanas";

const ChatContext = createContext(null);

function leerVentanas() {
  try {
    const guardadas = JSON.parse(sessionStorage.getItem(CLAVE_VENTANAS));
    return Array.isArray(guardadas) ? guardadas : [];
  } catch {
    return [];
  }
}

function avisarAlNavegador(titulo, cuerpo) {
  try {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      new Notification(titulo, { body: cuerpo, tag: "chat" });
    }
  } catch {
    /* Algunos navegadores no permiten avisos fuera de un service worker. */
  }
}

export function ChatProvider({ children }) {
  const [conversaciones, setConversaciones] = useState([]);
  const [noLeidos, setNoLeidos] = useState({});
  const [mensajes, setMensajes] = useState({});
  const [ventanas, setVentanas] = useState(leerVentanas);
  const cursor = useRef(null);
  const conocidas = useRef(new Set());
  const ventanasRef = useRef(ventanas);

  useEffect(() => {
    ventanasRef.current = ventanas;
    try {
      sessionStorage.setItem(CLAVE_VENTANAS, JSON.stringify(ventanas));
    } catch {
      /* Sin almacenamiento, las pestañas no sobreviven a recargar. */
    }
  }, [ventanas]);

  const cargarConversaciones = useCallback(async () => {
    try {
      const lista = await chatService.conversaciones();
      conocidas.current = new Set(lista.map((c) => c.id));
      setConversaciones(lista);
      setNoLeidos(Object.fromEntries(lista.map((c) => [c.id, c.no_leidos])));
      return lista;
    } catch {
      return null;
    }
  }, []);

  const leer = useCallback(async (id) => {
    setNoLeidos((actual) => ({ ...actual, [id]: 0 }));
    try {
      await chatService.leer(id);
    } catch {
      /* Se reintenta con el próximo mensaje. */
    }
  }, []);

  const cargarMensajes = useCallback(async (id, antes) => {
    try {
      const datos = await chatService.mensajes(id, antes);
      setMensajes((actual) => {
        const previos = actual[id]?.lista ?? [];
        const lista = antes
          ? [...datos.mensajes, ...previos]
          : [
              ...datos.mensajes,
              ...previos.filter(
                (m) => !datos.mensajes.some((n) => n.id === m.id),
              ),
            ].sort((a, b) => a.id - b.id);
        return { ...actual, [id]: { lista, hayMas: datos.hay_mas } };
      });
    } catch {
      /* La conversación muestra lo que ya tenía. */
    }
  }, []);

  const abrir = useCallback(
    (id, { expandir = true } = {}) => {
      setVentanas((actual) => {
        const otra = actual.filter((v) => v.id !== id);
        const previa = actual.find((v) => v.id === id);
        // Una conversación que llega sola queda como estaba; si no estaba,
        // aparece minimizada.
        const abierta = expandir || Boolean(previa?.abierta);
        return [...otra, { id, abierta }].slice(-4);
      });
      if (expandir) {
        cargarMensajes(id);
        leer(id);
      }
    },
    [cargarMensajes, leer],
  );

  const alternar = useCallback(
    (id) => {
      const actual = ventanasRef.current.find((v) => v.id === id);
      const abrirla = !actual?.abierta;
      setVentanas((lista) =>
        lista.map((v) => (v.id === id ? { ...v, abierta: abrirla } : v)),
      );
      if (abrirla) {
        cargarMensajes(id);
        leer(id);
      }
    },
    [cargarMensajes, leer],
  );

  const cerrar = useCallback((id) => {
    setVentanas((lista) => lista.filter((v) => v.id !== id));
  }, []);

  const enviar = useCallback(async (id, texto, archivo) => {
    const mensaje = await chatService.enviar(id, texto, archivo);
    setMensajes((actual) => {
      const previos = actual[id]?.lista ?? [];
      if (previos.some((m) => m.id === mensaje.id)) return actual;
      return {
        ...actual,
        [id]: { ...(actual[id] ?? {}), lista: [...previos, mensaje] },
      };
    });
    return mensaje;
  }, []);

  const iniciarDirecta = useCallback(
    async (usuario) => {
      const conversacion = await chatService.directa(usuario);
      await cargarConversaciones();
      abrir(conversacion.id);
      return conversacion;
    },
    [abrir, cargarConversaciones],
  );

  const crearGrupo = useCallback(
    async (datos) => {
      const conversacion = await chatService.crearGrupo(datos);
      await cargarConversaciones();
      abrir(conversacion.id);
      return conversacion;
    },
    [abrir, cargarConversaciones],
  );

  // La consulta periódica de lo nuevo.
  useEffect(() => {
    let vigente = true;
    async function consultar() {
      try {
        const datos = await chatService.novedades(cursor.current);
        if (!vigente || !datos) return;
        cursor.current = datos.cursor;
        setNoLeidos((actual) => ({ ...actual, ...datos.no_leidos }));
        const nuevos = datos.mensajes ?? [];
        if (nuevos.length === 0) return;
        setMensajes((actual) => {
          const siguiente = { ...actual };
          for (const mensaje of nuevos) {
            const previa = siguiente[mensaje.conversacion];
            if (!previa) continue; // se cargará al abrirla
            if (previa.lista.some((m) => m.id === mensaje.id)) continue;
            siguiente[mensaje.conversacion] = {
              ...previa,
              lista: [...previa.lista, mensaje],
            };
          }
          return siguiente;
        });
        const ajenos = nuevos.filter((m) => !m.propio);
        if (
          nuevos.some((m) => !conocidas.current.has(m.conversacion)) ||
          ajenos.length > 0
        ) {
          cargarConversaciones();
        }
        for (const mensaje of ajenos) {
          const ventana = ventanasRef.current.find(
            (v) => v.id === mensaje.conversacion,
          );
          if (!ventana) {
            abrir(mensaje.conversacion, { expandir: false });
          } else if (ventana.abierta && !document.hidden) {
            leer(mensaje.conversacion);
          }
          if (document.hidden || !ventana?.abierta) {
            avisarAlNavegador(
              `Mensaje de ${mensaje.autor?.nombre ?? "alguien"}`,
              mensaje.texto || mensaje.archivo?.nombre || "",
            );
          }
        }
      } catch {
        /* Sin red: se intenta de nuevo en el próximo turno. */
      }
    }
    cargarConversaciones();
    consultar();
    const intervalo = setInterval(consultar, INTERVALO_MS);
    return () => {
      vigente = false;
      clearInterval(intervalo);
    };
  }, [abrir, cargarConversaciones, leer]);

  const valor = useMemo(
    () => ({
      conversaciones,
      noLeidos,
      totalNoLeidos: Object.values(noLeidos).reduce((a, b) => a + (b || 0), 0),
      mensajes,
      ventanas,
      abrir,
      alternar,
      cerrar,
      cargarMensajes,
      enviar,
      leer,
      iniciarDirecta,
      crearGrupo,
      cargarConversaciones,
    }),
    [
      conversaciones,
      noLeidos,
      mensajes,
      ventanas,
      abrir,
      alternar,
      cerrar,
      cargarMensajes,
      enviar,
      leer,
      iniciarDirecta,
      crearGrupo,
      cargarConversaciones,
    ],
  );

  return <ChatContext.Provider value={valor}>{children}</ChatContext.Provider>;
}

export function useChat() {
  return useContext(ChatContext);
}
