import { useEffect, useId, useRef, useState } from "react";

import { NOVA_CHAT_MAX_CARACTERES } from "../../../api/novaService";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { ConfirmDialog } from "../../common/ConfirmDialog/ConfirmDialog";
import { Icon } from "../../common/Icon/Icon";
import { MODOS, avisoDeEstado, useNovaChat } from "./NovaChatContext";
import "./ConversacionNova.css";

/** Ideas para empezar, por modo (un clic las envía). */
const SUGERENCIAS = {
  general: [
    "¿Qué dice el reglamento interno sobre las vacaciones?",
    "¿Cómo preparo una retroalimentación de desempeño?",
  ],
  tareas: [
    "¿Qué tareas debería priorizar esta semana?",
    "¿Tengo tareas vencidas o en riesgo?",
  ],
  equipo: [
    "¿Quién de mi equipo tiene más carga de trabajo?",
    "¿Qué tareas vencidas tiene mi equipo?",
  ],
};

/** A partir de aquí se muestra cuánto queda del mensaje. */
const AVISO_DE_LARGO = NOVA_CHAT_MAX_CARACTERES - 200;

/** Táctil: Enter hace un salto de línea y se envía con el botón. */
const TACTIL = "(pointer: coarse)";

function prefiereSinMovimiento() {
  return Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
  );
}

function Mensaje({ mensaje }) {
  if (mensaje.rol === "usuario") {
    return (
      <li
        className={`nova-mensaje nova-mensaje--usuario${
          mensaje.noEnviado ? " nova-mensaje--no-enviado" : ""
        }`}
        data-id={mensaje.id}
      >
        <span className="visually-hidden">Usted: </span>
        <p className="nova-mensaje__texto">{mensaje.texto}</p>
        {mensaje.noEnviado && (
          <span className="nova-mensaje__estado">
            <Icon name="exclamation-circle" /> No se envió
          </span>
        )}
      </li>
    );
  }
  if (mensaje.rol === "aviso") {
    return (
      <li className="nova-mensaje nova-mensaje--aviso" data-id={mensaje.id}>
        <Icon name="info-circle" />
        <p className="nova-mensaje__texto">
          <span className="visually-hidden">Aviso: </span>
          {mensaje.texto}
        </p>
      </li>
    );
  }
  return (
    <li className="nova-mensaje nova-mensaje--modelo" data-id={mensaje.id}>
      <span className="nova-mensaje__autor" aria-hidden="true">
        <Icon name="stars" /> Nova
      </span>
      <span className="visually-hidden">Nova: </span>
      <p className="nova-mensaje__texto">{mensaje.texto}</p>
      {mensaje.fuentes?.length > 0 && (
        <div className="nova-mensaje__fuentes">
          <span className="mz-strong">Documentos consultados:</span>
          <ul>
            {mensaje.fuentes.map((f) => (
              <li key={`${f.documento_id}-${f.pagina}`}>
                {f.titulo}, pág. {f.pagina}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/**
 * La conversación con Nova: modo, aviso de IA, mensajes y caja de texto. La
 * usan el panel flotante y la página «Nova».
 *
 * - Enter envía; Shift+Enter hace un salto de línea (durante la composición
 *   de una tilde, Enter la confirma). En pantallas táctiles Enter hace un
 *   salto de línea y se envía con el botón.
 * - Los mensajes van en un `role="log"`: el lector de pantalla anuncia cada
 *   mensaje nuevo; «Nova está escribiendo…» va en su propio `role="status"`.
 * - El foco se queda en la caja de texto al enviar.
 * - Un mensaje sin respuesta de la IA queda «No se envió» y su texto vuelve a
 *   la caja; si fue la red o Nova tardó, una alerta ofrece «Reintentar».
 * - Con Nova no disponible (sin clave, límite…) no hay sugerencias y la caja
 *   queda de solo lectura, descrita por el aviso.
 *
 * @param {object} props
 * @param {"panel" | "pagina"} [props.variante]
 * @param {boolean} [props.enfocar] Pone el foco en la caja al montarse (al
 *   llegar desde «Abrir en página»).
 */
export function ConversacionNova({ variante = "panel", enfocar = false }) {
  const id = useId();
  const {
    modo,
    setModo,
    mensajes,
    borrador,
    setBorrador,
    enviando,
    enviar,
    reintentar,
    fallo,
    nuevaConversacion,
    estado,
    cargarEstado,
  } = useNovaChat();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState("");
  const caja = useRef(null);
  const registro = useRef(null);
  const tactil = useMediaQuery(TACTIL);

  useEffect(() => {
    cargarEstado();
  }, [cargarEstado]);

  useEffect(() => {
    if (!enfocar) return undefined;
    // Después de que el panel que se cerró devuelva su foco.
    const espera = setTimeout(() => caja.current?.focus(), 0);
    return () => clearTimeout(espera);
  }, [enfocar]);

  // Con cada mensaje nuevo se desplaza solo el contenedor del registro, nunca
  // la ventana: la respuesta de Nova se muestra desde su inicio (para leerla
  // de arriba abajo); lo demás, hasta el final.
  const ultimo = mensajes[mensajes.length - 1];
  useEffect(() => {
    const contenedor = registro.current;
    if (!contenedor) return;
    let destino = contenedor.scrollHeight;
    if (ultimo?.rol === "modelo" && !enviando) {
      const elemento = [...contenedor.querySelectorAll("[data-id]")].find(
        (el) => el.dataset.id === ultimo.id,
      );
      if (elemento) {
        destino =
          elemento.getBoundingClientRect().top -
          contenedor.getBoundingClientRect().top +
          contenedor.scrollTop -
          8;
      }
    }
    if (typeof contenedor.scrollTo === "function") {
      contenedor.scrollTo({
        top: destino,
        behavior: prefiereSinMovimiento() ? "auto" : "smooth",
      });
    } else {
      contenedor.scrollTop = destino;
    }
  }, [ultimo, enviando]);

  const modos = MODOS.filter((m) => m.id !== "equipo" || estado?.chat_equipo);
  // Si el modo elegido ya no corresponde (p. ej. sin equipo), vuelve a General.
  useEffect(() => {
    if (estado && !modos.some((m) => m.id === modo)) setModo("general");
  }, [estado, modo, modos, setModo]);
  const actual = MODOS.find((m) => m.id === modo) ?? MODOS[0];
  const aviso = avisoDeEstado(estado);
  const noDisponible = Boolean(aviso);
  const largo = borrador.length;
  const demasiado = largo > NOVA_CHAT_MAX_CARACTERES;
  // El exceso de caracteres se anuncia en la misma alerta que los errores.
  const alerta =
    error ||
    (demasiado
      ? `El mensaje tiene ${largo} caracteres y el máximo es ${NOVA_CHAT_MAX_CARACTERES}.`
      : "");

  async function mandar(texto) {
    if (enviando || noDisponible) return;
    if (!String(texto ?? "").trim()) {
      setError("Escriba su mensaje para Nova.");
      caja.current?.focus();
      return;
    }
    if (String(texto).length > NOVA_CHAT_MAX_CARACTERES) {
      // La alerta ya lo dice mientras se escribe: solo se vuelve a la caja.
      caja.current?.focus();
      return;
    }
    setError("");
    caja.current?.focus();
    await enviar(texto);
  }

  function alTeclear(evento) {
    if (
      evento.key === "Enter" &&
      !evento.shiftKey &&
      !tactil &&
      !evento.nativeEvent?.isComposing
    ) {
      evento.preventDefault();
      mandar(borrador);
    }
  }

  const describe = [noDisponible && `${id}-aviso`, `${id}-ayuda`, `${id}-error`]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`nova-conversacion nova-conversacion--${variante}`}>
      <div className="nova-conversacion__arriba">
        <div className="nova-modo">
          <label htmlFor={`${id}-modo`} className="form-label mb-1">
            Modo
          </label>
          <select
            id={`${id}-modo`}
            className="form-select form-select-sm"
            value={modo}
            onChange={(e) => setModo(e.target.value)}
            aria-describedby={`${id}-modo-ayuda`}
          >
            {modos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
          <p id={`${id}-modo-ayuda`} className="mz-small mz-faint mb-0">
            {actual.descripcion} Cada modo tiene su propia conversación.
          </p>
        </div>
        {mensajes.length > 0 && (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setConfirmando(true)}
          >
            <Icon name="arrow-counterclockwise" /> Nueva conversación
          </button>
        )}
      </div>

      <div className="nova-aviso mz-small" role="note">
        <p className="nova-aviso__linea mb-0">
          <Icon name="shield-lock" />
          <span>
            Nova es una IA y puede equivocarse. No se envían nombres.{" "}
            {actual.privacidad}
          </span>
        </p>
        <details className="nova-aviso__mas">
          <summary>Cómo se protegen sus datos</summary>
          <p className="mb-0">
            Revise las respuestas antes de decidir. Las personas se envían con
            seudónimos («Persona A»), nunca con su nombre, y antes de enviar se
            ocultan correos, cédulas y teléfonos. En el modo General puede
            preguntar por políticas de salud (licencias, permisos médicos,
            maternidad); en Mis tareas y Mi equipo los mensajes que mencionan
            salud no se envían. La conversación no se guarda: se pierde al
            cerrar sesión o recargar la página.
          </p>
        </details>
      </div>

      {aviso && (
        <p
          id={`${id}-aviso`}
          className="mz-alert mz-alert--info mb-0"
          role="status"
        >
          <Icon name="info-circle" />
          <span>{aviso}</span>
        </p>
      )}

      <div className="nova-mensajes" ref={registro}>
        {mensajes.length === 0 && !noDisponible ? (
          <div className="nova-vacio">
            <p className="mb-2">
              Hola, soy Nova. ¿En qué le ayudo? Puede empezar con una de estas
              preguntas:
            </p>
            <ul className="nova-sugerencias">
              {SUGERENCIAS[modo].map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => mandar(s)}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {/* Siempre montado: una región viva que aparece junto con su
            contenido no se anuncia en varios lectores. */}
        <ol
          className="nova-lista"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="Conversación con Nova"
        >
          {mensajes.map((m) => (
            <Mensaje key={m.id} mensaje={m} />
          ))}
        </ol>
        <p className="nova-escribiendo mz-small mz-faint mb-0" role="status">
          {enviando && (
            <>
              <span
                className="spinner-border spinner-border-sm me-2"
                aria-hidden="true"
              />
              Nova está escribiendo…
            </>
          )}
        </p>
      </div>

      {fallo && (
        <div className="mz-alert mz-alert--bad nova-fallo mb-0" role="alert">
          <Icon name="exclamation-triangle" />
          <span className="nova-fallo__texto">{fallo.mensaje}</span>
          <button
            type="button"
            className="btn btn-outline-danger btn-sm"
            onClick={() => {
              caja.current?.focus();
              reintentar();
            }}
            aria-disabled={enviando}
          >
            <Icon name="arrow-clockwise" /> Reintentar
          </button>
        </div>
      )}

      <form
        className="nova-redactar"
        onSubmit={(e) => {
          e.preventDefault();
          mandar(borrador);
        }}
      >
        <label htmlFor={`${id}-mensaje`} className="visually-hidden">
          Mensaje para Nova
        </label>
        <textarea
          id={`${id}-mensaje`}
          ref={caja}
          className={`form-control${alerta ? " is-invalid" : ""}`}
          rows={2}
          value={borrador}
          readOnly={noDisponible}
          onChange={(e) => {
            setBorrador(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={alTeclear}
          placeholder={
            noDisponible ? "Nova no está disponible" : "Escriba su pregunta…"
          }
          aria-describedby={describe}
          aria-invalid={Boolean(alerta)}
          data-autofocus
        />
        <div className="nova-redactar__pie">
          <p id={`${id}-ayuda`} className="mz-small mz-faint mb-0">
            {!tactil && "Enter envía; Shift+Enter hace un salto de línea."}
            {largo > AVISO_DE_LARGO &&
              !demasiado &&
              ` ${largo} de ${NOVA_CHAT_MAX_CARACTERES} caracteres.`}
          </p>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            aria-disabled={enviando || noDisponible}
          >
            <Icon name="send" /> {enviando ? "Enviando…" : "Enviar"}
          </button>
        </div>
        <p
          id={`${id}-error`}
          className="nova-redactar__error mz-small mb-0"
          role="alert"
        >
          {alerta}
        </p>
      </form>

      <ConfirmDialog
        isOpen={confirmando}
        title="Nueva conversación"
        message={`Se borrará la conversación del modo «${actual.nombre}». No se puede recuperar: el servidor no la guarda.`}
        confirmLabel="Borrar y empezar de nuevo"
        confirmVariant="danger"
        onCancel={() => setConfirmando(false)}
        onConfirm={() => {
          nuevaConversacion();
          setConfirmando(false);
          caja.current?.focus();
        }}
      />
    </div>
  );
}
