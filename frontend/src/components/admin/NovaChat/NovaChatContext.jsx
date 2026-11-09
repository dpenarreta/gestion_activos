import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

import { errorDeNova, novaService } from "../../../api/novaService";

/**
 * El chat de Nova (portado de `useNovaChat` de Nexo, 09/11/2026).
 *
 * Como en Nexo, la conversación vive solo en el navegador: el servidor no la
 * guarda y la recibe de vuelta en cada mensaje (`historial`). Vive aquí, en el
 * marco de `/admin`, para que el panel flotante y la página «Nova» muestren la
 * misma; se pierde al cerrar sesión o recargar. Cada modo lleva su propia
 * conversación: los datos que ve Nova cambian de un modo a otro.
 */

/**
 * Salud (decisión del 09/11/2026): en General, sin datos de personas, se
 * puede preguntar por políticas de licencias o permisos médicos; en Mis
 * tareas y Mi equipo nunca se envía nada de salud. `privacidad` lo dice en el
 * aviso de cada modo.
 */
const SALUD_NO_SE_ENVIA = "En este modo no se envían datos de salud.";

export const MODOS = [
  {
    id: "general",
    nombre: "General",
    descripcion:
      "Preguntas generales y sobre los documentos de la base de conocimiento.",
    privacidad:
      "Puede preguntar por políticas sobre licencias o permisos médicos, pero no escriba datos de salud suyos ni de otras personas.",
  },
  {
    id: "tareas",
    nombre: "Mis tareas",
    descripcion:
      "Nova ve sus tareas (título, prioridad, fechas, horas y avance) para ayudarle a priorizar.",
    privacidad: SALUD_NO_SE_ENVIA,
  },
  {
    id: "equipo",
    nombre: "Mi equipo",
    descripcion:
      "Nova ve las cifras de tareas y horas de su equipo según el organigrama, con seudónimos.",
    privacidad: SALUD_NO_SE_ENVIA,
  },
];

/** Turnos que se reenvían como mucho (el servidor también recorta). */
export const MAXIMO_TURNOS = 12;

const VACIAS = { general: [], tareas: [], equipo: [] };

let contador = 0;
function nuevoId() {
  contador += 1;
  return `nova-${Date.now()}-${contador}`;
}

/**
 * Los turnos anteriores para el servidor: solo las preguntas que tuvieron
 * respuesta de Nova, con esa respuesta (los avisos de «sin IA» no son parte
 * de la conversación), y como mucho los últimos `maximo`.
 */
export function construirHistorial(mensajes, maximo = MAXIMO_TURNOS) {
  const turnos = [];
  for (let i = 0; i < mensajes.length - 1; i += 1) {
    const actual = mensajes[i];
    const siguiente = mensajes[i + 1];
    if (actual.rol === "usuario" && siguiente.rol === "modelo") {
      turnos.push({ rol: "usuario", texto: actual.texto });
      turnos.push({ rol: "modelo", texto: siguiente.texto });
      i += 1;
    }
  }
  const recorte = turnos.slice(-maximo);
  return recorte[0]?.rol === "modelo" ? recorte.slice(1) : recorte;
}

/**
 * Lo que dice la pantalla cuando Nova no está disponible hoy: qué pasa y qué
 * puede hacer la persona.
 */
export function avisoDeEstado(estado) {
  if (!estado || estado.disponible) return null;
  switch (estado.motivo) {
    case "sin_clave":
      return "Nova no está configurada en este entorno. Pida al administrador del sistema que la active.";
    case "sin_consentimiento":
      return "Para conversar con Nova, acepte el aviso de tratamiento de datos vigente.";
    case "limite":
      return `Llegó al límite de ${estado.limite_diario} consultas diarias. Puede volver a escribir mañana.`;
    default:
      return estado.mensaje ?? "Nova no está disponible en este momento.";
  }
}

/** Lo que se dice cuando un mensaje no tuvo respuesta de la IA. */
export const MENSAJE_SALUD =
  "Su mensaje menciona temas de salud y en este modo no se envía a Nova. Si es una pregunta general sobre políticas, hágala en el modo General.";
export const MENSAJE_LIMITE =
  "Llegó al límite diario de consultas. Puede volver a escribir mañana.";

/**
 * Por qué un mensaje no tuvo respuesta de la IA (`con_ia: false`). Decide por
 * `motivo` y `causa`, nunca por el texto. `reintentable`: vale la pena volver
 * a enviarlo tal cual (Nova tardó o falló).
 */
export function motivoSinIa(datos) {
  if (datos?.motivo === "bloqueado" && datos?.causa === "salud") {
    return { texto: MENSAJE_SALUD, reintentable: false };
  }
  if (datos?.motivo === "limite") {
    return { texto: MENSAJE_LIMITE, reintentable: false };
  }
  return {
    texto: datos?.mensaje ?? "Nova no pudo responder su mensaje.",
    reintentable: datos?.motivo === "fallo",
  };
}

const Contexto = createContext(null);

export function NovaChatProvider({ children }) {
  const [modo, setModo] = useState("general");
  const [mensajes, setMensajes] = useState(VACIAS);
  const [borrador, setBorrador] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [estado, setEstado] = useState(null);
  const enviandoRef = useRef(false);
  const mensajesRef = useRef(VACIAS);
  mensajesRef.current = mensajes;

  /** Qué modos tiene y si la IA está disponible (una vez por sesión). */
  const pedidoEstado = useRef(null);
  const cargarEstado = useCallback((forzar = false) => {
    if (pedidoEstado.current && !forzar) return;
    pedidoEstado.current = novaService
      .me()
      .then(setEstado)
      .catch(() => {
        // Sin el estado se puede escribir igual: el servidor responde claro.
        pedidoEstado.current = null;
      });
  }, []);

  const agregar = useCallback((enModo, mensaje) => {
    const id = nuevoId();
    setMensajes((actuales) => ({
      ...actuales,
      [enModo]: [...actuales[enModo], { id, ...mensaje }],
    }));
    return id;
  }, []);

  const marcarNoEnviado = useCallback((enModo, id) => {
    setMensajes((actuales) => ({
      ...actuales,
      [enModo]: actuales[enModo].map((m) =>
        m.id === id ? { ...m, noEnviado: true } : m,
      ),
    }));
  }, []);

  /**
   * El fallo del último envío que se puede reintentar (red o Nova sin
   * responder): `{ modo, id, texto, mensaje }`. La pantalla lo muestra como
   * alerta con «Reintentar».
   */
  const [fallo, setFallo] = useState(null);

  const enviar = useCallback(
    async (texto) => {
      const mensaje = String(texto ?? "").trim();
      if (!mensaje || enviandoRef.current) return false;
      const enModo = modo;
      const historial = construirHistorial(mensajesRef.current[enModo]);
      enviandoRef.current = true;
      setEnviando(true);
      setFallo(null);
      const id = agregar(enModo, { rol: "usuario", texto: mensaje });
      setBorrador("");
      // Sin respuesta de la IA, el mensaje queda marcado «No se envió» y su
      // texto vuelve a la caja, salvo que ya se haya escrito otro.
      const noSeEnvio = () => {
        marcarNoEnviado(enModo, id);
        setBorrador((actual) => (actual ? actual : mensaje));
      };
      try {
        const datos = await novaService.chat({
          modo: enModo,
          mensaje,
          historial,
        });
        if (datos.con_ia) {
          agregar(enModo, {
            rol: "modelo",
            texto: datos.respuesta,
            fuentes: datos.fuentes ?? [],
          });
        } else {
          noSeEnvio();
          const motivo = motivoSinIa(datos);
          if (motivo.reintentable) {
            setFallo({
              modo: enModo,
              id,
              texto: mensaje,
              mensaje: motivo.texto,
            });
          } else {
            agregar(enModo, { rol: "aviso", texto: motivo.texto });
          }
          // Sin IA (límite, aviso de datos…): el estado de arriba se pone al día.
          cargarEstado(true);
        }
      } catch (err) {
        noSeEnvio();
        setFallo({
          modo: enModo,
          id,
          texto: mensaje,
          mensaje: errorDeNova(
            err,
            "No se pudo enviar su mensaje a Nova. Revise su conexión.",
          ).mensaje,
        });
      } finally {
        enviandoRef.current = false;
        setEnviando(false);
      }
      return true;
    },
    [agregar, cargarEstado, marcarNoEnviado, modo],
  );

  /** Vuelve a enviar el mensaje que falló; su burbuja «No se envió» se va. */
  const reintentar = useCallback(async () => {
    if (!fallo || enviandoRef.current) return false;
    const { modo: enModo, id, texto } = fallo;
    setMensajes((actuales) => ({
      ...actuales,
      [enModo]: actuales[enModo].filter((m) => m.id !== id),
    }));
    // El texto que se devolvió a la caja ya no hace falta ahí.
    setBorrador((actual) => (actual === texto ? "" : actual));
    return enviar(texto);
  }, [enviar, fallo]);

  const nuevaConversacion = useCallback(() => {
    setMensajes((actuales) => ({ ...actuales, [modo]: [] }));
    setFallo((actual) => (actual?.modo === modo ? null : actual));
  }, [modo]);

  const valor = {
    modo,
    setModo,
    mensajes: mensajes[modo],
    borrador,
    setBorrador,
    enviando,
    enviar,
    reintentar,
    fallo: fallo?.modo === modo ? fallo : null,
    nuevaConversacion,
    estado,
    cargarEstado,
  };
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useNovaChat() {
  const valor = useContext(Contexto);
  if (!valor) {
    throw new Error("useNovaChat debe usarse dentro de <NovaChatProvider>.");
  }
  return valor;
}
