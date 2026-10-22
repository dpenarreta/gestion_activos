import { useEffect, useRef, useState } from "react";

import { chatService } from "../../../api/chatService";
import { formatearFecha } from "../../../utils/formato";
import { descargarBlob } from "../../../utils/descargas";
import { Icon } from "../../common/Icon/Icon";
import { useChat } from "./ChatContext";
import { AvisoDeEstado, usePresencia } from "./Presencia";

/** Las iniciales de un nombre: «Carla Ordóñez» → «CO». */
export function iniciales(nombre) {
  const partes = (nombre || "?").trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** El color de cada persona, fijo: el mismo número de usuario, el mismo tono. */
export function tonoDe(id) {
  return Math.abs(Number(id) || 0) % 6;
}

/** Una foto del chat: se pide con la sesión y se muestra como blob. */
function Imagen({ archivo }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let creada = null;
    chatService
      .archivo(archivo.url)
      .then((blob) => {
        creada = URL.createObjectURL(blob);
        setUrl(creada);
      })
      .catch(() => setUrl(null));
    return () => creada && URL.revokeObjectURL(creada);
  }, [archivo.url]);
  return url ? (
    <img className="chat-imagen" src={url} alt={archivo.nombre} />
  ) : (
    <span className="mz-small mz-faint">
      <Icon name="image" /> {archivo.nombre}
    </span>
  );
}

function Archivo({ archivo }) {
  if (archivo.es_imagen) return <Imagen archivo={archivo} />;
  return (
    <button
      type="button"
      className="btn btn-link btn-sm p-0 chat-archivo"
      onClick={async () => {
        try {
          descargarBlob(await chatService.archivo(archivo.url), archivo.nombre);
        } catch {
          /* El archivo ya no está disponible. */
        }
      }}
    >
      <Icon name="paperclip" /> {archivo.nombre}
    </button>
  );
}

/**
 * Los mensajes de una conversación y la caja para escribir. Enter envía y
 * Mayús + Enter salta de línea. Un archivo de más de 10 MB no se sube: se
 * sugiere mandarlo por correo, con las direcciones de quienes lo recibirían.
 */
/** Cada cuánto se vuelve a preguntar quién leyó, con la conversación abierta. */
const REFRESCO_LECTURAS_MS = 10_000;

/** Hasta dónde leyó cada una de las demás personas; se repite mientras la
 * conversación está abierta y al llegar o enviarse un mensaje. */
function useLecturas(conversacionId, cantidad) {
  const [lecturas, setLecturas] = useState([]);
  useEffect(() => {
    let vigente = true;
    const pedir = () =>
      Promise.resolve()
        .then(() => chatService.lecturas(conversacionId))
        .then((datos) => vigente && setLecturas(datos ?? []))
        .catch(() => {});
    pedir();
    const intervalo = setInterval(pedir, REFRESCO_LECTURAS_MS);
    return () => {
      vigente = false;
      clearInterval(intervalo);
    };
  }, [conversacionId, cantidad]);
  return lecturas;
}

function hora(fecha) {
  return new Date(fecha).toLocaleTimeString("es-EC", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * La confirmación de lectura de un mensaje propio (22/10/2026): ✓ enviado,
 * ✓✓ leído. En un grupo, por cuántos y quiénes.
 */
export function EstadoLectura({ mensaje, lecturas, grupal }) {
  const leyeron = lecturas.filter((l) => l.ultimo_leido >= mensaje.id);
  const total = lecturas.length;
  if (total === 0) return null;
  const todos = leyeron.length === total;
  let texto;
  let detalle;
  if (!grupal) {
    texto = leyeron.length ? "Leído" : "Enviado";
    detalle = leyeron[0]?.leido_en
      ? `Visto a las ${hora(leyeron[0].leido_en)}`
      : texto;
  } else {
    texto = todos
      ? "Leído por todos"
      : leyeron.length
        ? `Leído por ${leyeron.length} de ${total}`
        : "Enviado";
    detalle = leyeron.length
      ? `Lo leyeron: ${leyeron.map((l) => l.nombre).join(", ")}`
      : "Nadie lo ha leído todavía";
  }
  return (
    <span
      className={`chat-lectura${leyeron.length ? " chat-lectura--leido" : ""}${
        todos ? " chat-lectura--todos" : ""
      }`}
      title={detalle}
    >
      <Icon name={leyeron.length ? "check2-all" : "check2"} />
      <span className="chat-lectura__texto">{texto}</span>
    </span>
  );
}

export function Conversacion({ conversacion, compacta = false }) {
  const chat = useChat();
  const datos = chat.mensajes[conversacion.id];
  const [texto, setTexto] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [error, setError] = useState(null);
  const [demasiadoGrande, setDemasiadoGrande] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const fondo = useRef(null);
  const entradaArchivo = useRef(null);
  const cantidad = datos?.lista.length ?? 0;
  const grupal = conversacion.tipo !== "directa";
  const lecturas = useLecturas(conversacion.id, cantidad);
  // En un directo, si la otra persona está en almuerzo, de vacaciones…
  const otroId = grupal ? null : conversacion.otro?.id;
  const presenciaDelOtro = usePresencia(otroId ? [otroId] : []);
  const estadoDelOtro = otroId ? presenciaDelOtro[otroId]?.estado : null;
  // Al enviar, a quiénes no les llegará enseguida (los de un grupo).
  const [avisos, setAvisos] = useState([]);

  const { cargarMensajes } = chat;
  useEffect(() => {
    if (!datos) cargarMensajes(conversacion.id);
  }, [conversacion.id, datos, cargarMensajes]);

  useEffect(() => {
    fondo.current?.scrollIntoView?.({ block: "end" });
  }, [cantidad]);

  async function enviar(evento) {
    evento?.preventDefault();
    if (!texto.trim() && !archivo) return;
    setEnviando(true);
    setError(null);
    setDemasiadoGrande(null);
    try {
      const enviado = await chat.enviar(conversacion.id, texto, archivo);
      setAvisos(grupal ? (enviado?.avisos ?? []) : []);
      setTexto("");
      setArchivo(null);
      if (entradaArchivo.current) entradaArchivo.current.value = "";
    } catch (err) {
      const detalle = err?.response?.data?.error;
      if (detalle?.code === "archivo_grande") {
        setDemasiadoGrande(detalle.details);
      } else {
        const campos = detalle?.details ?? {};
        setError(
          campos.archivo?.[0] ||
            campos.texto?.[0] ||
            detalle?.message ||
            "No se pudo enviar el mensaje.",
        );
      }
    } finally {
      setEnviando(false);
    }
  }

  const asunto = encodeURIComponent(`Archivo: ${archivo?.name ?? ""}`);

  return (
    <div
      className={`chat-conversacion${compacta ? " chat-conversacion--compacta" : ""}${
        grupal ? " chat-conversacion--grupo" : ""
      }`}
    >
      <div className="chat-mensajes" aria-live="polite">
        {datos?.hayMas && (
          <button
            type="button"
            className="btn btn-link btn-sm d-block mx-auto"
            onClick={() =>
              chat.cargarMensajes(conversacion.id, datos.lista[0]?.id)
            }
          >
            Ver mensajes anteriores
          </button>
        )}
        {datos && datos.lista.length === 0 && (
          <p className="mz-small mz-faint text-center my-3">
            Todavía no hay mensajes. ¡Escriba el primero!
          </p>
        )}
        {(datos?.lista ?? []).map((m) => {
          const burbuja = (
            <div
              className={`chat-mensaje${m.propio ? " chat-mensaje--propio" : ""}`}
            >
              {grupal && (
                <span className="chat-mensaje__autor">
                  {m.propio ? "Usted" : (m.autor?.nombre ?? "Alguien")}
                </span>
              )}
              {m.texto && <p className="chat-mensaje__texto">{m.texto}</p>}
              {m.archivo && <Archivo archivo={m.archivo} />}
              <span className="chat-mensaje__hora">
                {formatearFecha(m.fecha, true)}
                {m.propio && (
                  <EstadoLectura
                    mensaje={m}
                    lecturas={lecturas}
                    grupal={grupal}
                  />
                )}
              </span>
            </div>
          );
          if (!grupal)
            return (
              <div
                key={m.id}
                className={`chat-fila${m.propio ? " chat-fila--propia" : ""}`}
              >
                {burbuja}
              </div>
            );
          // En un grupo, cada mensaje dice quién lo envió: su nombre y un
          // círculo con sus iniciales, del mismo color siempre.
          return (
            <div
              key={m.id}
              className={`chat-fila chat-fila--grupo${m.propio ? " chat-fila--propia" : ""}`}
            >
              <span
                className={`chat-avatar chat-avatar--${tonoDe(m.autor?.id)}`}
                aria-hidden="true"
                title={m.autor?.nombre}
              >
                {iniciales(m.propio ? "Usted" : m.autor?.nombre)}
              </span>
              {burbuja}
            </div>
          );
        })}
        <div ref={fondo} />
      </div>

      {demasiadoGrande && (
        <div className="mz-alert mz-alert--warn chat-aviso" role="alert">
          <Icon name="envelope" />
          <span>
            El archivo supera los {demasiadoGrande.limite_mb} MB del chat.
            Envíelo por correo
            {demasiadoGrande.correos?.length > 0 && (
              <>
                {" "}
                a{" "}
                {demasiadoGrande.correos.map((correo, i) => (
                  <span key={correo}>
                    {i > 0 && ", "}
                    <a href={`mailto:${correo}?subject=${asunto}`}>{correo}</a>
                  </span>
                ))}
              </>
            )}
            .
          </span>
        </div>
      )}
      {error && (
        <div className="mz-alert mz-alert--bad chat-aviso" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {estadoDelOtro && (
        <AvisoDeEstado nombre={conversacion.nombre} estado={estadoDelOtro} />
      )}
      {avisos.map((a) => (
        <AvisoDeEstado key={a.usuario} nombre={a.nombre} estado={a} />
      ))}
      <form className="chat-redactar" onSubmit={enviar}>
        {archivo && (
          <div className="chat-adjunto">
            <Icon name="paperclip" /> {archivo.name}
            <button
              type="button"
              className="btn btn-link btn-sm p-0 ms-1"
              aria-label="Quitar el archivo"
              onClick={() => {
                setArchivo(null);
                setDemasiadoGrande(null);
                if (entradaArchivo.current) entradaArchivo.current.value = "";
              }}
            >
              <Icon name="x" />
            </button>
          </div>
        )}
        <div className="chat-redactar__fila">
          <label
            className="btn btn-link btn-sm p-1 mb-0"
            title="Adjuntar foto o archivo"
          >
            <Icon name="paperclip" />
            <input
              ref={entradaArchivo}
              type="file"
              className="visually-hidden"
              aria-label="Adjuntar foto o archivo"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
              onChange={(e) => {
                setDemasiadoGrande(null);
                setArchivo(e.target.files?.[0] ?? null);
              }}
            />
          </label>
          <textarea
            className="form-control form-control-sm"
            rows={1}
            maxLength={4000}
            placeholder="Escriba un mensaje"
            aria-label={`Mensaje para ${conversacion.nombre}`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={enviando || (!texto.trim() && !archivo)}
            aria-label="Enviar"
          >
            <Icon name="send" />
          </button>
        </div>
      </form>
    </div>
  );
}
