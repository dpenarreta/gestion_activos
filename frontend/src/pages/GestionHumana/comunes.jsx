/*
 * Lo que comparten las pantallas de Gestión Humana: etiquetas, formatos, el
 * aviso de resultado, el indicador del guardado automático y su cola de
 * envío con reintentos y respaldo.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Icon } from "../../components/common/Icon/Icon";
import { esReintentable } from "../../api/novedadesService";

export const ESTADO_COLABORADOR = {
  ACTIVE: "Activo",
  SUSPENDED: "Suspendido",
  INACTIVE: "Inactivo",
};

export const TONO_COLABORADOR = {
  ACTIVE: "mz-pill--ok",
  SUSPENDED: "mz-pill--warn",
  INACTIVE: "mz-pill--neutral",
};

export function EstadoColaborador({ estado }) {
  return (
    <span
      className={`mz-pill ${TONO_COLABORADOR[estado] ?? "mz-pill--neutral"}`}
    >
      {ESTADO_COLABORADOR[estado] ?? estado}
    </span>
  );
}

/** Estado del mes de Horas extras (lo calcula el servidor). */
export const ESTADO_MES = {
  OPEN: "En curso",
  GRACE: "En plazo de cierre",
  OVERDUE: "Plazo vencido",
  CLOSED: "Cerrado",
  FUTURE: "Futuro",
};

export const TONO_MES = {
  OPEN: "mz-pill--info",
  GRACE: "mz-pill--warn",
  OVERDUE: "mz-pill--bad",
  CLOSED: "mz-pill--neutral",
  FUTURE: "mz-pill--neutral",
};

/** Estado del período 23 → 22 de un equipo. */
export const ESTADO_PERIODO = {
  OPEN: "Abierto",
  CLOSED: "Cerrado",
  NOT_STARTED: "Sin iniciar",
};

export const TONO_PERIODO = {
  OPEN: "mz-pill--ok",
  CLOSED: "mz-pill--neutral",
  NOT_STARTED: "mz-pill--warn",
};

export const ROL_OPERATIVO = {
  SUPERVISOR_OPERACIONES: "Supervisor de Operaciones",
  ASISTENTE_OPERACIONES: "Asistente de Operaciones",
  JEFE_OPERACIONES: "Jefe de Operaciones",
  ADMINISTRADOR: "Administrador",
};

/** «2026-10-05» → «05/10/2026», sin pasar por zonas horarias. */
export function fecha(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : String(iso);
}

/** Fecha y hora en Ecuador. */
export function fechaHora(iso) {
  if (!iso) return "—";
  const valor = new Date(iso);
  if (Number.isNaN(valor.getTime())) return String(iso);
  return valor.toLocaleString("es-EC", {
    timeZone: "America/Guayaquil",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** El día de hoy en el navegador (local, no UTC: a las 19:00 de Ecuador
 * `toISOString()` ya da el día siguiente). */
export function hoyLocal() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
}

/** Día de la semana de una fecha ISO (0 = domingo) sin zonas horarias. */
export function diaDeSemana(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** «1 d 4 h», «3 h 20 min» o «12 min». */
export function tiempoRestante(segundos) {
  const minutos = Math.max(Math.floor((segundos ?? 0) / 60), 0);
  const dias = Math.floor(minutos / 1440);
  const horas = Math.floor((minutos % 1440) / 60);
  const resto = minutos % 60;
  if (dias) return `${dias} d ${horas} h`;
  if (horas) return `${horas} h ${resto} min`;
  return `${resto} min`;
}

/** Horas en una celda: hasta 2 enteros y 2 decimales, con punto o coma. */
export const HORAS_MIENTRAS_ESCRIBE = /^\d{0,2}([.,]\d{0,2})?$/;

/** Un aviso del resultado de una acción, cerca de donde se hizo. */
export function Aviso({ aviso, onCerrar }) {
  if (!aviso) return null;
  const tono = aviso.tono ?? "ok";
  const icono = {
    ok: "check2-circle",
    warn: "exclamation-triangle",
    bad: "x-octagon",
    info: "info-circle",
  }[tono];
  return (
    <div
      className={`mz-alert mz-alert--${tono}`}
      role={tono === "bad" ? "alert" : "status"}
    >
      <Icon name={icono} />
      <span className="flex-grow-1">{aviso.texto}</span>
      {aviso.accion && (
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={aviso.accion.onClick}
        >
          {aviso.accion.texto}
        </button>
      )}
      {onCerrar && (
        <button
          type="button"
          className="mz-close"
          aria-label="Cerrar el aviso"
          onClick={onCerrar}
        >
          <Icon name="x-lg" />
        </button>
      )}
    </div>
  );
}

/** Un error dentro de una ventana o sobre una tabla. */
export function ErrorEnLinea({ mensaje, className = "" }) {
  if (!mensaje) return null;
  return (
    <div className={`mz-alert mz-alert--bad ${className}`.trim()} role="alert">
      <Icon name="x-octagon" />
      <span>{mensaje}</span>
    </div>
  );
}

const TEXTO_GUARDADO = {
  idle: "",
  saving: "Guardando…",
  saved: "Guardado",
  pending: "Pendiente de sincronizar",
  error: "No se guardó todo",
};

/**
 * El estado real del guardado automático: lo que el servidor confirmó, nunca
 * un éxito anticipado. Región viva: los lectores de pantalla lo anuncian.
 */
export function IndicadorDeGuardado({
  estado,
  pendientes = 0,
  mensaje,
  onReintentar,
  children,
}) {
  const texto =
    estado === "idle" && pendientes
      ? `Cambios por enviar: ${pendientes}`
      : TEXTO_GUARDADO[estado];
  return (
    <div
      className={`gh-guardado gh-guardado--${estado}`}
      aria-live="polite"
      data-sync={estado}
    >
      {estado === "saving" && (
        <span className="spinner-border spinner-border-sm" aria-hidden="true" />
      )}
      {estado === "saved" && <Icon name="check2" />}
      {texto && <span>{texto}</span>}
      {mensaje && <span className="mz-faint">{mensaje}</span>}
      {estado === "pending" && onReintentar && (
        <button
          type="button"
          className="btn btn-link btn-sm p-0"
          onClick={onReintentar}
        >
          Reintentar ahora
        </button>
      )}
      {children}
    </div>
  );
}

const ESPERA_AL_ESCRIBIR = 1200;
const REINTENTOS = [2000, 5000, 15000, 30000, 60000];

/**
 * La cola del guardado automático (Días laborados, Horas extras, Horas
 * depuradas): una sola petición en vuelo; lo que cambia mientras tanto se
 * envía en la siguiente; tras escribir espera un poco (no una petición por
 * tecla); ante un corte de red reintenta de forma escalonada y con tope, y
 * cuando vuelve la conexión envía enseguida. No pregunta al servidor por su
 * cuenta: solo envía lo que la persona cambió.
 *
 * `enviar` hace el trabajo y devuelve `{ fallo }`, con el error de
 * `errorDeNovedades` si la petición no llegó a responder bien.
 */
export function useColaDeGuardado(enviar) {
  const [estado, setEstado] = useState("idle");
  const [mensaje, setMensaje] = useState(null);
  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;
  const enVuelo = useRef(false);
  const repetir = useRef(false);
  const intento = useRef(0);
  const reloj = useRef(null);
  const montado = useRef(true);

  const ejecutar = useCallback(async () => {
    if (!montado.current) return;
    if (enVuelo.current) {
      repetir.current = true;
      return;
    }
    enVuelo.current = true;
    let resultado;
    try {
      resultado = await enviarRef.current({
        alEmpezar: () => setEstado("saving"),
      });
    } finally {
      enVuelo.current = false;
    }
    if (!montado.current) return;
    const fallo = resultado?.fallo;
    if (fallo && esReintentable(fallo.estado)) {
      setEstado("pending");
      setMensaje(
        `${fallo.mensaje} Los cambios se conservan y se reintentará automáticamente.`,
      );
      const espera =
        REINTENTOS[Math.min(intento.current, REINTENTOS.length - 1)];
      intento.current += 1;
      programarRef.current(espera);
    } else if (fallo) {
      intento.current = 0;
      setEstado("error");
      setMensaje(fallo.mensaje);
    } else if (resultado?.rechazadas) {
      intento.current = 0;
      setEstado("error");
      setMensaje(resultado.rechazadas);
    } else if (resultado?.enviadas) {
      intento.current = 0;
      setEstado("saved");
      setMensaje(null);
    }
    if (repetir.current) {
      repetir.current = false;
      programarRef.current(50);
    }
  }, []);

  const programar = useCallback(
    (espera = ESPERA_AL_ESCRIBIR) => {
      if (reloj.current) clearTimeout(reloj.current);
      reloj.current = setTimeout(ejecutar, espera);
    },
    [ejecutar],
  );
  const programarRef = useRef(programar);
  programarRef.current = programar;

  useEffect(() => {
    montado.current = true;
    const alVolverLaRed = () => programarRef.current(0);
    window.addEventListener("online", alVolverLaRed);
    return () => {
      montado.current = false;
      if (reloj.current) clearTimeout(reloj.current);
      window.removeEventListener("online", alVolverLaRed);
    };
  }, []);

  return {
    estado,
    setEstado,
    mensaje,
    setMensaje,
    programar,
    enVuelo,
    ahora: () => programar(0),
  };
}

/**
 * Respaldo de lo que el servidor todavía no confirmó, por pantalla, período,
 * equipo y persona. Vive en `sessionStorage` (se borra al cerrar la pestaña)
 * y guarda solo identificadores y valores capturados, nunca la cédula: es un
 * resguardo ante un corte de red o un cambio de pantalla, no un segundo lugar
 * donde viven los datos. Sin almacenamiento disponible la pantalla sigue
 * funcionando, solo sin respaldo.
 */
export function respaldo(ambito) {
  const clave = `gestion_humana:pendiente:${ambito}`;
  return {
    leer() {
      try {
        const crudo = window.sessionStorage.getItem(clave);
        return crudo ? JSON.parse(crudo) : null;
      } catch {
        return null;
      }
    },
    guardar(valor) {
      try {
        window.sessionStorage.setItem(clave, JSON.stringify(valor));
      } catch {
        // Sin espacio o bloqueado: se sigue sin respaldo.
      }
    },
    borrar() {
      try {
        window.sessionStorage.removeItem(clave);
      } catch {
        // idem
      }
    },
  };
}

/**
 * «Más acciones» (⋯): las acciones secundarias de una fila, para que la fila
 * no se llene de botones (sobre todo en el teléfono). Patrón de menú WAI-ARIA:
 * se abre con el botón, las flechas recorren las opciones, Escape cierra y
 * devuelve el foco al botón. La lista se posiciona fija para que no la
 * recorte el contenedor con desplazamiento de una grilla.
 *
 * `acciones`: `[{ texto, onClick, peligro? }]` (los `false` se ignoran).
 * `contenido`: lo que muestra el botón en vez de «⋯» (el estado de una
 * tarea, que abre «Mover a…»); `idBoton`, para devolverle el foco.
 */
export function MenuDeAcciones({ etiqueta, acciones, contenido, idBoton }) {
  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState(null);
  const raiz = useRef(null);
  const boton = useRef(null);
  const lista = useRef(null);
  const visibles = acciones.filter(Boolean);

  useLayoutEffect(() => {
    if (!abierto || !boton.current) return;
    const caja = boton.current.getBoundingClientRect();
    const ancho = 240;
    setPosicion({
      top: caja.bottom + 4,
      left: Math.max(
        8,
        Math.min(caja.right - ancho, window.innerWidth - ancho - 8),
      ),
    });
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return undefined;
    lista.current?.querySelector('[role="menuitem"]')?.focus();
    const fuera = (e) => {
      if (!raiz.current?.contains(e.target)) setAbierto(false);
    };
    const alDesplazar = () => setAbierto(false);
    document.addEventListener("mousedown", fuera);
    window.addEventListener("resize", alDesplazar);
    // Fija sobre la página: si algo se desplaza (la página o una tabla), la
    // lista quedaría flotando lejos de su botón.
    window.addEventListener("scroll", alDesplazar, true);
    return () => {
      document.removeEventListener("mousedown", fuera);
      window.removeEventListener("resize", alDesplazar);
      window.removeEventListener("scroll", alDesplazar, true);
    };
  }, [abierto]);

  if (!visibles.length) return null;

  function teclas(evento) {
    const items = [
      ...(lista.current?.querySelectorAll('[role="menuitem"]') ?? []),
    ];
    const actual = items.indexOf(document.activeElement);
    const destino = {
      ArrowDown: (actual + 1) % items.length,
      ArrowUp: (actual - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    }[evento.key];
    if (evento.key === "Escape" || evento.key === "Tab") {
      if (evento.key === "Escape") {
        evento.preventDefault();
        evento.stopPropagation();
        boton.current?.focus();
      }
      setAbierto(false);
      return;
    }
    if (destino === undefined) return;
    evento.preventDefault();
    items[destino]?.focus();
  }

  return (
    <div className="gh-menu" ref={raiz}>
      <button
        ref={boton}
        type="button"
        id={idBoton}
        className={`btn btn-outline-secondary btn-sm gh-menu__boton${contenido ? " gh-menu__boton--texto" : ""}`}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={etiqueta}
        title={contenido ? undefined : "Más acciones"}
        onClick={() => setAbierto((a) => !a)}
      >
        {contenido ?? <Icon name="three-dots" />}
      </button>
      {abierto && (
        <ul
          ref={lista}
          role="menu"
          aria-label={etiqueta}
          className="gh-menu__lista"
          style={
            posicion ? { top: posicion.top, left: posicion.left } : undefined
          }
          onKeyDown={teclas}
        >
          {visibles.map((a, i) => [
            // Lo destructivo, separado del resto.
            a.peligro && i > 0 && !visibles[i - 1].peligro && (
              <li
                role="separator"
                key={`sep-${a.texto}`}
                className="gh-menu__separador"
              />
            ),
            <li role="none" key={a.texto}>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`gh-menu__item${a.peligro ? " gh-menu__item--peligro" : ""}`}
                onClick={() => {
                  // El foco vuelve al botón «⋯» antes de actuar: si la
                  // acción abre una confirmación y se cancela, el foco
                  // regresa ahí y no a <body> (auditoría UX/UI, 05/11/2026).
                  boton.current?.focus();
                  setAbierto(false);
                  a.onClick();
                }}
              >
                {a.texto}
              </button>
            </li>,
          ])}
        </ul>
      )}
    </div>
  );
}
