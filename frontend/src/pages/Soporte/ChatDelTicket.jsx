import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";

/** Cada cuánto se buscan mensajes nuevos (con la pestaña a la vista). */
const REFRESCO_MS = 8_000;

/** ¿Hay teclado físico? En el teclado del teléfono no existe Mayús + Enter:
 * ahí Enter hace un salto de línea y se envía con el botón. */
function conTecladoFisico() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: fine)").matches !== false
  );
}

function resumen(texto) {
  return texto.length > 120 ? `${texto.slice(0, 120)}…` : texto;
}

/**
 * El chat del ticket entre el técnico que lo tomó y quien lo reportó
 * (30/10/2026): para aclarar detalles sin salir del ticket. Se ve solo aquí,
 * no en el chat personal, y queda guardado para auditoría. No es una
 * respuesta del ticket: no cambia su estado ni sus plazos.
 *
 * Lo usan la ficha del equipo y la de quien pide, cada una con su servicio
 * (`cargar` y `enviar` devuelven `{abierto, puede_escribir, motivo,
 * mensajes}`). Auditoría UX/UI (30/10/2026): quién habló con su rol, el foco
 * vuelve al campo tras enviar, Enter envía solo con teclado físico, se avisa
 * si no se pudo actualizar y la lista no salta al final si se lee más arriba.
 */
export function ChatDelTicket({ titulo, nota, cargar, enviar }) {
  const id = useId();
  const [datos, setDatos] = useState(null);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [anuncio, setAnuncio] = useState("");
  const lista = useRef(null);
  const campo = useRef(null);
  const ultimo = useRef(null);
  const propioRecien = useRef(false);
  const alFinal = useRef(true);
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;

  const actualizar = useCallback(() => {
    // Dentro de la promesa: un fallo al llamar también se atrapa.
    Promise.resolve()
      .then(() => cargarRef.current())
      .then((nuevos) => {
        if (!nuevos) return;
        const idUltimo = nuevos.mensajes.at(-1)?.id ?? 0;
        // Lo que escribe el otro se anuncia (resumido); lo propio, no.
        if (ultimo.current !== null && idUltimo !== ultimo.current) {
          const llegados = nuevos.mensajes.filter(
            (m) => m.id > ultimo.current && !m.mio,
          );
          if (llegados.length) {
            const ultimoLlegado = llegados.at(-1);
            setAnuncio(
              `${
                llegados.length === 1
                  ? "Mensaje nuevo"
                  : `${llegados.length} mensajes nuevos`
              } de ${ultimoLlegado.autor}: ${resumen(ultimoLlegado.texto)}`,
            );
          }
        }
        ultimo.current = idUltimo;
        setDatos(nuevos);
        setErrorCarga(null);
      })
      .catch((err) =>
        setErrorCarga(mensajeDeError(err, "No se pudo cargar el chat.")),
      );
  }, []);

  useEffect(() => {
    actualizar();
    const intervalo = setInterval(() => {
      if (document.visibilityState !== "hidden") actualizar();
    }, REFRESCO_MS);
    // Al volver a la pestaña, al día en el acto.
    const alVolver = () => {
      if (document.visibilityState === "visible") actualizar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [actualizar]);

  // Baja al último mensaje si ya se estaba al final o si es propio (no
  // interrumpe a quien lee mensajes de más arriba).
  const cuantos = datos?.mensajes.length ?? 0;
  useEffect(() => {
    const el = lista.current;
    if (el && (alFinal.current || propioRecien.current))
      el.scrollTop = el.scrollHeight;
    propioRecien.current = false;
  }, [cuantos]);

  async function mandar(evento) {
    evento?.preventDefault();
    if (enviando) return;
    if (!texto.trim()) {
      setError("Escriba un mensaje.");
      campo.current?.focus();
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const nuevos = await enviar(texto.trim());
      ultimo.current = nuevos.mensajes.at(-1)?.id ?? 0;
      propioRecien.current = true;
      setDatos(nuevos);
      setTexto("");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo enviar el mensaje."));
      // Pudo cambiar el ticket (cerrado, resuelto): se refleja enseguida.
      actualizar();
    } finally {
      setEnviando(false);
      // El foco sigue en el campo para seguir escribiendo.
      requestAnimationFrame(() => campo.current?.focus());
    }
  }

  return (
    <section className="mz-card soporte-chat" aria-labelledby={`${id}-titulo`}>
      <div className="mz-card-head">
        <h3 id={`${id}-titulo`}>
          <Icon name="chat-dots" /> {titulo}
        </h3>
      </div>
      <div className="mz-card-body">
        <p className="mz-small mz-faint">{nota}</p>
        <p className="visually-hidden" aria-live="polite">
          {anuncio}
        </p>
        {errorCarga && !datos && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {errorCarga}
          </div>
        )}
        <p className="mz-small mz-faint mb-1" role="status">
          {datos === null && !errorCarga
            ? "Cargando el chat…"
            : datos && errorCarga
              ? "No se pudo actualizar el chat; se reintenta solo."
              : ""}
        </p>
        {datos && (
          <ol
            ref={lista}
            className="soporte-chat__lista"
            aria-label="Mensajes del chat"
            onScroll={(e) => {
              const el = e.currentTarget;
              alFinal.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            // Una región que se desplaza: se enfoca para leerla con el
            // teclado (WCAG 2.1.1).
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
          >
            {datos.mensajes.length === 0 && (
              <li className="mz-faint soporte-chat__vacio">
                Aún no han conversado. Úselo para aclarar detalles; la respuesta
                formal va en «Conversación».
              </li>
            )}
            {datos.mensajes.map((m) => (
              <li
                key={m.id}
                className={`soporte-chat__mensaje${m.mio ? " soporte-chat__mensaje--mio" : ""}`}
              >
                <div className="soporte-chat__cabeza">
                  {/* El rol, en texto: no depende de la posición ni del color. */}
                  <span
                    className={`mz-pill ${m.del_solicitante ? "soporte-pill--info" : "mz-pill--neutral"}`}
                  >
                    {m.del_solicitante ? "Usuario" : "Técnico"}
                  </span>
                  <strong>{m.mio ? "Usted" : m.autor}</strong>
                  <time className="mz-faint" dateTime={m.fecha}>
                    {formatearFecha(m.fecha, true)}
                  </time>
                </div>
                <p className="mb-0">{m.texto}</p>
              </li>
            ))}
          </ol>
        )}
        {datos?.puede_escribir ? (
          <form className="soporte-chat__escribir" onSubmit={mandar} noValidate>
            <label className="visually-hidden" htmlFor={`${id}-texto`}>
              Mensaje
            </label>
            <textarea
              id={`${id}-texto`}
              ref={campo}
              className={`form-control${error ? " is-invalid" : ""}`}
              rows={2}
              maxLength={2000}
              value={texto}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-pista${error ? ` ${id}-error` : ""}`}
              onChange={(e) => {
                setTexto(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  conTecladoFisico()
                ) {
                  e.preventDefault();
                  mandar();
                }
              }}
            />
            {/* Ocupado, no deshabilitado: el foco no se pierde al enviar. */}
            <button
              type="submit"
              className="btn btn-primary"
              aria-disabled={enviando || undefined}
            >
              <Icon name="send" /> {enviando ? "Enviando…" : "Enviar"}
            </button>
            <small id={`${id}-pista`} className="mz-small mz-faint w-100">
              Con teclado: Enter envía; Mayús + Enter, nueva línea.
            </small>
            {error && (
              <div
                id={`${id}-error`}
                className="mz-field-error w-100"
                role="alert"
              >
                {error}
              </div>
            )}
          </form>
        ) : (
          datos?.motivo && (
            <p className="mz-small mb-0 mt-2 soporte-chat__motivo">
              <Icon name="info-circle" /> {datos.motivo}
            </p>
          )
        )}
      </div>
    </section>
  );
}
