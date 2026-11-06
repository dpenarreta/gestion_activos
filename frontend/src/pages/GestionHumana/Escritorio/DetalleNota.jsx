/*
 * Una nota abierta (`NoteDetailModal` de Nexo): el mensaje en su color, el
 * adjunto en el visor interno, las respuestas (como mucho `max_replies` por
 * nota, nunca un chat: se dice cuántas quedan), «Convertir en recordatorio»
 * (solo quien la recibió, una vez) y el historial.
 *
 * Como en Nexo, abrir una nota recibida sin leer la marca leída (a quien la
 * dejó le llega el aviso). Si la nota llega a medias (desde «Hoy» o el
 * buscador), se pide entera.
 */
import { useEffect, useId, useRef, useState } from "react";

import {
  errorDeEscritorio,
  escritorioService,
} from "../../../api/escritorioService";
import { Campo } from "../../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { ErrorEnLinea, fechaHora } from "../comunes";
import { enfocarDespues } from "../enfocar";
import { aCampoLocal, deCampoLocal } from "../Reuniones/reunionesComunes";
import { Ventana } from "../Tareas/Ventanas";
import { useEscritorio } from "./ContextoEscritorio";
import {
  MENSAJE_MAX,
  NOTA_A_RECORDATORIO,
  TITULO_MAX,
  claseDeColor,
  nombreDe,
  respuestasRestantes,
} from "./escritorioComunes";
import { Adjunto, Historial, Pildora } from "./Piezas";

const completa = (nota) => Boolean(nota && "reply_count" in nota);

export function DetalleNota({ id, inicial = null, onCerrar, onCambio }) {
  const { refrescarSinLeer } = useEscritorio();
  const [nota, setNota] = useState(completa(inicial) ? inicial : null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [vez, setVez] = useState(0);
  const leida = useRef(false);

  useEffect(() => {
    if (completa(nota) && vez === 0) return undefined;
    let vigente = true;
    setErrorCarga(null);
    escritorioService
      .obtenerNota(id)
      .then((datos) => {
        if (vigente) setNota(datos);
      })
      .catch((err) => {
        if (vigente)
          setErrorCarga(
            errorDeEscritorio(err, "No se pudo abrir la nota.").mensaje,
          );
      });
    return () => {
      vigente = false;
    };
    // Solo al abrir y al reintentar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, vez]);

  // Abrir una nota recibida sin leer la marca leída (una vez).
  useEffect(() => {
    if (!nota || nota.is_mine || nota.read || leida.current) return;
    leida.current = true;
    escritorioService
      .accionDeNota(nota.id, "read")
      .then((nueva) => {
        actualizar(nueva);
        refrescarSinLeer();
      })
      .catch(() => {
        // No es grave: queda sin leer y se puede marcar desde la tarjeta.
        leida.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nota?.id, nota?.read]);

  function actualizar(nueva) {
    setNota(nueva);
    onCambio?.(nueva);
  }

  const enviada = Boolean(nota?.is_mine);
  const titulo = !nota
    ? "Nota"
    : enviada
      ? `Nota para ${nombreDe(nota.recipient)}`
      : `Nota de ${nombreDe(nota.sender)}`;

  return (
    <Ventana
      titulo={titulo}
      subtitulo={nota ? fechaHora(nota.created_at) : undefined}
      onCerrar={onCerrar}
    >
      {!nota ? (
        <EstadoDeCarga
          cargando={!errorCarga}
          error={errorCarga}
          onReintentar={() => setVez((v) => v + 1)}
        />
      ) : (
        <ContenidoNota nota={nota} onActualizada={actualizar} />
      )}
    </Ventana>
  );
}

function ContenidoNota({ nota, onActualizada }) {
  const { prioridadesNota, colores } = useEscritorio();
  const enviada = nota.is_mine;
  const color = colores.find((c) => c.id === nota.color);
  return (
    <div className="ed-detalle">
      <div className={`ed-detalle__mensaje ${claseDeColor(nota.color)}`}>
        <p className="ed-texto">{nota.message}</p>
        <div className="mz-pill-row">
          <Pildora opciones={prioridadesNota} valor={nota.priority} />
          {nota.pinned && !enviada && (
            <span className="mz-pill mz-pill--neutral">
              <Icon name="pin-angle-fill" /> Fijada
            </span>
          )}
          {nota.archived && (
            <span className="mz-pill mz-pill--neutral">
              <Icon name="archive" /> Archivada
            </span>
          )}
          {color && (
            <span className="visually-hidden">
              Nota de color {color.texto}.
            </span>
          )}
        </div>
      </div>
      {enviada && (
        <p className="mz-small mb-0">
          <Icon name={nota.read ? "check2-all" : "check2"} />{" "}
          {nota.read
            ? `Leída el ${fechaHora(nota.read_at)}`
            : "Entregada, todavía sin leer"}
        </p>
      )}
      <Adjunto adjunto={nota.attachment} idBase={`nota-${nota.id}`} />
      <Respuestas nota={nota} onActualizada={onActualizada} />
      {!enviada && (
        <ConvertirEnRecordatorio nota={nota} onActualizada={onActualizada} />
      )}
      <Historial cargar={() => escritorioService.historialDeNota(nota.id)} />
    </div>
  );
}

/** Las respuestas cortas: se listan y, mientras quede alguna, se responde.
 * Si otra persona ocupó la última antes (409), se dice y se cierra el
 * formulario. */
function Respuestas({ nota, onActualizada }) {
  const { ajustes } = useEscritorio();
  const idCampo = `${useId()}-respuesta`;
  const [respuestas, setRespuestas] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState("");
  const [errorCampo, setErrorCampo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [topeAlcanzado, setTopeAlcanzado] = useState(false);
  // El motivo del 409 va aparte: recargar las respuestas no lo borra.
  const [motivoTope, setMotivoTope] = useState(null);
  const enCurso = useRef(false);
  const campo = useRef(null);
  const maximo = ajustes.max_replies;

  function cargar() {
    setError(null);
    setRespuestas(null);
    escritorioService
      .respuestas(nota.id)
      .then((lista) => setRespuestas(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setError(
          errorDeEscritorio(err, "No se pudieron cargar las respuestas.")
            .mensaje,
        ),
      );
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nota.id]);

  const usadas = respuestas?.length ?? nota.reply_count ?? 0;
  const restantes = Math.max(0, maximo - usadas);
  const puede = !topeAlcanzado && restantes > 0 && nota.can_reply !== false;

  async function responder(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    if (!texto.trim()) {
      setErrorCampo("Escriba la respuesta.");
      campo.current?.focus();
      return;
    }
    enCurso.current = true;
    setEnviando(true);
    setErrorCampo(null);
    try {
      const nueva = await escritorioService.responder(nota.id, texto.trim());
      const lista = [...(respuestas ?? []), nueva];
      setRespuestas(lista);
      setTexto("");
      // Era la última: el formulario desaparece y el foco va al aviso del
      // tope (si no, caía en <body>).
      if (lista.length >= maximo) enfocarDespues(`${idCampo}-tope`);
      onActualizada({
        ...nota,
        reply_count: lista.length,
        can_reply: lista.length < maximo,
      });
    } catch (err) {
      const e = errorDeEscritorio(err, "No se pudo enviar la respuesta.");
      if (e.estado === 409 || e.codigo === "conflict") {
        setTopeAlcanzado(true);
        setMotivoTope(e.mensaje);
        enfocarDespues(`${idCampo}-tope`);
        cargar();
        onActualizada({ ...nota, reply_count: maximo, can_reply: false });
      } else {
        setErrorCampo(e.campos.message || e.mensaje);
        campo.current?.focus();
      }
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  return (
    <section className="ed-seccion" aria-labelledby={`${idCampo}-titulo`}>
      <h4 id={`${idCampo}-titulo`} className="ed-subtitulo">
        Respuestas{" "}
        <span className="mz-faint mz-small">
          ({usadas} de {maximo})
        </span>
      </h4>
      <ErrorEnLinea mensaje={error} />
      {motivoTope && (
        <div className="mz-alert mz-alert--warn" role="alert">
          <Icon name="exclamation-triangle" />
          <span>{motivoTope}</span>
        </div>
      )}
      {respuestas === null && !error ? (
        <p className="mz-small mz-faint mb-0" role="status">
          Cargando…
        </p>
      ) : respuestas?.length === 0 ? (
        <p className="mz-small mz-faint mb-0">Todavía no hay respuestas.</p>
      ) : (
        respuestas?.length > 0 && (
          <ol className="ed-respuestas">
            {respuestas.map((r) => (
              <li key={r.id} className="ed-respuesta">
                <p className="mz-small mb-1">
                  <span className="mz-strong">{nombreDe(r.author)}</span>
                  <span className="mz-faint"> · {fechaHora(r.created_at)}</span>
                </p>
                <p className="ed-texto mb-0">{r.message}</p>
              </li>
            ))}
          </ol>
        )
      )}
      {respuestas !== null &&
        (puede ? (
          <form className="ed-responder" onSubmit={responder} noValidate>
            <label htmlFor={idCampo} className="form-label">
              Su respuesta
            </label>
            <textarea
              ref={campo}
              id={idCampo}
              className={`form-control${errorCampo ? " is-invalid" : ""}`}
              rows={2}
              maxLength={MENSAJE_MAX}
              value={texto}
              aria-invalid={errorCampo ? true : undefined}
              aria-describedby={`${idCampo}-ayuda${errorCampo ? ` ${idCampo}-error` : ""}`}
              onChange={(e) => {
                setTexto(e.target.value);
                setErrorCampo(null);
              }}
            />
            <p id={`${idCampo}-ayuda`} className="form-text mb-0">
              {texto.length} de {MENSAJE_MAX} caracteres.{" "}
              {respuestasRestantes(restantes)}
            </p>
            {errorCampo && (
              <p id={`${idCampo}-error`} className="mz-field-error mb-0">
                {errorCampo}
              </p>
            )}
            <div className="ed-acciones">
              <button
                type="submit"
                className="btn btn-outline-primary btn-sm"
                disabled={enviando}
              >
                <Icon name="reply" /> {enviando ? "Enviando…" : "Responder"}
              </button>
            </div>
          </form>
        ) : (
          <p
            id={`${idCampo}-tope`}
            className="mz-small ed-tope mb-0"
            tabIndex={-1}
          >
            <Icon name="info-circle" /> Esta nota ya tiene sus {maximo}{" "}
            respuestas. Si necesitan seguir, conviértala en un recordatorio o en
            una tarea.
          </p>
        ))}
    </section>
  );
}

/** Solo quien recibió la nota, una vez. El título y la prioridad se
 * proponen desde la nota (como el servidor) y se pueden cambiar. */
function ConvertirEnRecordatorio({ nota, onActualizada }) {
  const { prioridadesRecordatorio } = useEscritorio();
  const base = useId();
  const ids = {
    titulo: `${base}-titulo`,
    vence: `${base}-vence`,
    prioridad: `${base}-prioridad`,
  };
  const [abierto, setAbierto] = useState(false);
  const [valores, setValores] = useState(() => ({
    title: nota.message.slice(0, TITULO_MAX),
    due_at: "",
    priority: NOTA_A_RECORDATORIO[nota.priority] ?? "MEDIA",
  }));
  const [errores, setErrores] = useState({});
  const [hecho, setHecho] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);
  const boton = useRef(null);

  useEffect(() => {
    if (abierto) document.getElementById(ids.titulo)?.focus();
  }, [abierto, ids.titulo]);

  const idResultado = `${base}-resultado`;
  const convertida = Boolean(nota.converted_to_reminder_id);
  // Siempre montado y en el mismo lugar: el resultado de convertir se
  // anuncia (una región que nace ya con texto no se lee) y recibe el foco,
  // porque el formulario desaparece.
  const resultado = (
    <p id={idResultado} className="mz-small mb-0" role="status" tabIndex={-1}>
      {convertida && (
        <>
          <Icon name="check2-circle" />{" "}
          {hecho ?? "Esta nota ya se convirtió en un recordatorio."}
        </>
      )}
    </p>
  );

  if (convertida) return <section className="ed-seccion">{resultado}</section>;

  function cambiar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  function cancelar() {
    setAbierto(false);
    setErrores({});
    requestAnimationFrame(() => boton.current?.focus());
  }

  async function convertir(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    if (!valores.due_at || !deCampoLocal(valores.due_at)) {
      setErrores({ due_at: "Elija cuándo quiere que se lo recuerde." });
      document.getElementById(ids.vence)?.focus();
      return;
    }
    enCurso.current = true;
    setEnviando(true);
    setErrores({});
    try {
      const r = await escritorioService.convertirEnRecordatorio(nota.id, {
        due_at: deCampoLocal(valores.due_at),
        title: valores.title.trim(),
        priority: valores.priority,
      });
      setHecho(
        `Se creó el recordatorio «${r.reminder_title}». Lo encuentra en Recordatorios.`,
      );
      enfocarDespues(idResultado);
      onActualizada({
        ...nota,
        converted_to_reminder_id: r.reminder_id,
        converted_at: new Date().toISOString(),
      });
    } catch (err) {
      const e = errorDeEscritorio(
        err,
        "No se pudo convertir la nota en recordatorio.",
      );
      if (e.estado === 409 || e.codigo === "conflict") {
        // Ya se había convertido (otra pestaña, un doble clic): se refleja.
        setHecho(e.mensaje);
        enfocarDespues(idResultado);
        onActualizada({
          ...nota,
          converted_to_reminder_id: nota.converted_to_reminder_id ?? -1,
        });
      } else {
        const campos = Object.keys(e.campos).length
          ? e.campos
          : { general: e.mensaje };
        setErrores(campos);
        const primero = ["title", "due_at", "priority"].find((c) => campos[c]);
        const destino = {
          title: ids.titulo,
          due_at: ids.vence,
          priority: ids.prioridad,
        }[primero];
        if (destino) document.getElementById(destino)?.focus();
      }
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  return (
    <section className="ed-seccion">
      {resultado}
      <button
        ref={boton}
        type="button"
        className="btn btn-outline-secondary btn-sm"
        aria-expanded={abierto}
        aria-controls={`${base}-panel`}
        onClick={() => (abierto ? cancelar() : setAbierto(true))}
      >
        <Icon name="alarm" /> Convertir en recordatorio
      </button>
      {abierto && (
        // Escape dentro del formulario lo cierra sin cerrar la ventana.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <form
          id={`${base}-panel`}
          className="ed-subformulario"
          onSubmit={convertir}
          noValidate
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancelar();
            }
          }}
        >
          <ErrorEnLinea mensaje={errores.general} />
          <Campo
            id={ids.titulo}
            etiqueta="Título del recordatorio"
            error={errores.title}
            ayuda={`${valores.title.length} de ${TITULO_MAX} caracteres. Si lo deja vacío, se usa el mensaje.`}
          >
            <input
              type="text"
              className="form-control"
              maxLength={TITULO_MAX}
              value={valores.title}
              onChange={(e) => cambiar("title", e.target.value)}
            />
          </Campo>
          <Campo
            id={ids.vence}
            etiqueta="Recordarme el"
            obligatorio
            error={errores.due_at}
          >
            <input
              type="datetime-local"
              className="form-control"
              min={aCampoLocal(new Date().toISOString())}
              value={valores.due_at}
              onChange={(e) => cambiar("due_at", e.target.value)}
            />
          </Campo>
          <Campo
            id={ids.prioridad}
            etiqueta="Prioridad"
            error={errores.priority}
          >
            <select
              className="form-select"
              value={valores.priority}
              onChange={(e) => cambiar("priority", e.target.value)}
            >
              {prioridadesRecordatorio.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.texto}
                </option>
              ))}
            </select>
          </Campo>
          <div className="ed-acciones">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={cancelar}
              disabled={enviando}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={enviando}
            >
              {enviando ? "Creando…" : "Crear recordatorio"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
