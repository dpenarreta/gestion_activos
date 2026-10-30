import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";

/*
 * La llamada de voz del ticket (30/10/2026): entre el técnico a cargo y quien
 * lo reportó. El audio va directo entre los dos navegadores (WebRTC); el
 * servidor solo pasa la señalización y deja el registro en el historial del
 * ticket. No se graba ni toca los plazos.
 *
 * El micrófono solo se puede usar con HTTPS (o en localhost): sin eso, el
 * botón lo explica y no se busca nada.
 *
 * Sin tiempo real en el servidor, se consulta cada pocos segundos. Cada
 * consulta es también un «sigo aquí»: si un lado recarga, cierra o pierde la
 * red, el servidor corta la llamada sola y no deja el ticket bloqueado.
 *
 * Auditoría UX/UI (30/10/2026): no se roba el foco al sonar, «Conectando…»
 * al contestar, el timbre se puede silenciar, se busca también con la
 * pestaña en segundo plano (con aviso en el título), el panel va arriba sin
 * tapar el chat y los avisos dicen qué hacer después.
 */

const SEGUIR_LLAMADA_MS = 1_500;
const SEGUNDOS_DE_TIMBRE = 45;

export function sePuedeLlamar() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext === true &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window.RTCPeerConnection === "function"
  );
}

const LlamadasContext = createContext(null);

/** Para el botón «Llamar»: `null` fuera del proveedor. */
export function useLlamadas() {
  return useContext(LlamadasContext);
}

/** El error del micrófono, en palabras de quien lo usa. */
function textoErrorMicrofono(err, otro) {
  switch (err?.name) {
    case "NotAllowedError":
      return "Permita el micrófono con el candado de la barra de direcciones y vuelva a intentarlo.";
    case "NotFoundError":
      return "No hay un micrófono conectado a este equipo.";
    case "NotReadableError":
      return "El micrófono lo está usando otra aplicación: ciérrela y vuelva a intentarlo.";
    default:
      return mensajeDeError(
        err,
        otro
          ? `No se pudo llamar a ${otro}.`
          : "No se pudo conectar la llamada.",
      );
  }
}

/** Un timbre con el sintetizador del navegador (sin archivos): dos tonos
 * alternos, se puede silenciar. */
function useTimbre(sonando) {
  const [suspendido, setSuspendido] = useState(false);
  useEffect(() => {
    if (!sonando || typeof window.AudioContext !== "function") return undefined;
    const contexto = new window.AudioContext();
    // Sin un clic previo en la página el navegador lo deja en pausa.
    contexto
      .resume()
      .then(() => setSuspendido(contexto.state === "suspended"))
      .catch(() => setSuspendido(true));
    const tono = (frecuencia, inicio) => {
      const oscilador = contexto.createOscillator();
      const volumen = contexto.createGain();
      oscilador.frequency.value = frecuencia;
      volumen.gain.value = 0.2;
      oscilador.connect(volumen).connect(contexto.destination);
      oscilador.start(contexto.currentTime + inicio);
      oscilador.stop(contexto.currentTime + inicio + 0.4);
    };
    const timbre = () => {
      tono(440, 0);
      tono(660, 0.45);
    };
    timbre();
    const intervalo = setInterval(timbre, 2_500);
    return () => {
      clearInterval(intervalo);
      contexto.close();
    };
  }, [sonando]);
  return suspendido;
}

async function esperarCandidatos(conexion) {
  if (conexion.iceGatheringState === "complete") return;
  await new Promise((listo) => {
    const tope = setTimeout(listo, 2_500);
    conexion.addEventListener("icegatheringstatechange", () => {
      if (conexion.iceGatheringState === "complete") {
        clearTimeout(tope);
        listo();
      }
    });
  });
}

function reloj(segundos) {
  const m = Math.floor(segundos / 60);
  const s = String(segundos % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * El proveedor de llamadas: va en el marco de `/admin`, así una llamada
 * entrante suena en cualquier pantalla y la llamada sigue al navegar.
 */
export function LlamadasProvider({ children }) {
  // fase: null | "llamando" | "entrante" | "conectando" | "en_curso"
  const [llamada, setLlamada] = useState(null);
  const [fase, setFase] = useState(null);
  const [silenciado, setSilenciado] = useState(false);
  const [timbreCallado, setTimbreCallado] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [anuncio, setAnuncio] = useState("");
  const conexion = useRef(null);
  const microfono = useRef(null);
  const audio = useRef(null);
  const faseRef = useRef(null);
  faseRef.current = fase;
  const llamadaRef = useRef(null);
  llamadaRef.current = llamada;
  const segundosRef = useRef(0);
  segundosRef.current = segundos;
  // Para salir de `llamar()` si se colgó mientras se preparaba.
  const cancelada = useRef(false);
  // A dónde vuelve el foco al terminar (si se movió).
  const focoPrevio = useRef(null);

  const limpiar = useCallback((mensaje = null, esError = false) => {
    microfono.current?.getTracks().forEach((pista) => pista.stop());
    microfono.current = null;
    conexion.current?.close();
    conexion.current = null;
    if (audio.current) audio.current.srcObject = null;
    setFase(null);
    setLlamada(null);
    setSilenciado(false);
    setTimbreCallado(false);
    setSegundos(0);
    if (esError) {
      setError(mensaje);
      setAviso(null);
    } else {
      setAviso(mensaje);
    }
    if (mensaje) setAnuncio(mensaje);
    // El foco vuelve a donde estaba, si sigue en la página.
    const previo = focoPrevio.current;
    focoPrevio.current = null;
    if (previo?.isConnected) requestAnimationFrame(() => previo.focus?.());
  }, []);

  const colgarEnServidor = useCallback((id) => {
    if (id) soporteService.colgarLlamada(id).catch(() => null);
  }, []);

  const preparar = useCallback(async () => {
    const flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
    microfono.current = flujo;
    const pc = new window.RTCPeerConnection({ iceServers: [] });
    flujo.getTracks().forEach((pista) => pc.addTrack(pista, flujo));
    pc.ontrack = (evento) => {
      if (audio.current) audio.current.srcObject = evento.streams[0];
    };
    // Si la conexión de audio se cae (o queda desconectada más de 8 s), se
    // cuelga sola y se dice.
    let desconectada = null;
    pc.onconnectionstatechange = () => {
      clearTimeout(desconectada);
      const cortar = () => {
        const actual = llamadaRef.current;
        colgarEnServidor(actual?.id);
        limpiar(
          `Se cortó la llamada (${reloj(segundosRef.current)}). Quedó en el historial del ticket.`,
          true,
        );
      };
      if (pc.connectionState === "failed") cortar();
      else if (pc.connectionState === "disconnected")
        desconectada = setTimeout(cortar, 8_000);
    };
    conexion.current = pc;
    return pc;
  }, [colgarEnServidor, limpiar]);

  /** Llamar a la otra persona del ticket. */
  const llamar = useCallback(
    async (ticketId, otro) => {
      if (faseRef.current) return;
      cancelada.current = false;
      focoPrevio.current = document.activeElement;
      setError(null);
      setAviso(null);
      setFase("llamando");
      setLlamada({ otro, ticket: ticketId, soy_llamante: true });
      try {
        const pc = await preparar();
        if (cancelada.current) return limpiar();
        await pc.setLocalDescription(await pc.createOffer());
        await esperarCandidatos(pc);
        if (cancelada.current) return limpiar();
        const creada = await soporteService.llamar(
          ticketId,
          JSON.stringify(pc.localDescription),
        );
        // Colgó mientras se creaba: se cuelga también en el servidor.
        if (cancelada.current) {
          colgarEnServidor(creada.id);
          return limpiar();
        }
        setLlamada(creada);
      } catch (err) {
        if (cancelada.current) return limpiar();
        limpiar(textoErrorMicrofono(err, otro), true);
      }
      return undefined;
    },
    [colgarEnServidor, limpiar, preparar],
  );

  async function contestar() {
    // Una sola vez: un doble clic no abre dos micrófonos.
    if (faseRef.current !== "entrante") return;
    setError(null);
    setFase("conectando");
    try {
      const pc = await preparar();
      await pc.setRemoteDescription(JSON.parse(llamada.oferta));
      await pc.setLocalDescription(await pc.createAnswer());
      await esperarCandidatos(pc);
      const actual = await soporteService.contestarLlamada(
        llamada.id,
        JSON.stringify(pc.localDescription),
      );
      setLlamada(actual);
      setFase("en_curso");
      setAnuncio(`En llamada con ${actual.otro}.`);
    } catch (err) {
      const id = llamada?.id;
      colgarEnServidor(id);
      const vencio = err?.response?.status === 400;
      limpiar(
        vencio
          ? `La llamada dejó de sonar antes de conectarse. Puede devolverla con «Llamar a ${llamada?.otro}».`
          : textoErrorMicrofono(err),
        true,
      );
    }
  }

  function colgar() {
    const id = llamadaRef.current?.id;
    const fue = faseRef.current;
    if (fue === "llamando" && !id) cancelada.current = true;
    colgarEnServidor(id);
    limpiar(
      fue === "en_curso"
        ? `Llamada terminada (${reloj(segundos)}). Quedó en el historial del ticket.`
        : fue === "entrante"
          ? "Llamada rechazada."
          : null,
    );
  }

  function silenciar() {
    const nuevo = !silenciado;
    microfono.current?.getAudioTracks().forEach((pista) => {
      pista.enabled = !nuevo;
    });
    setSilenciado(nuevo);
  }

  // Las que suenan para mí. Con la pestaña oculta también se busca (más
  // espaciado) y se avisa en el título: quien reportó suele estar en otra
  // pestaña. Quien no tiene tickets con técnico pregunta mucho menos.
  useEffect(() => {
    if (!sePuedeLlamar()) return undefined;
    let vigente = true;
    let espera = null;
    let pausa = 3_000;
    let primera = true;
    const buscar = async () => {
      if (!vigente) return;
      if (!faseRef.current) {
        try {
          const datos = await soporteService.llamadasEntrantes();
          // Al entrar: lo que quedó de una recarga se cuelga (no se puede
          // retomar el audio).
          if (primera) {
            for (const vieja of datos?.activas ?? [])
              colgarEnServidor(vieja.id);
            if (datos?.activas?.length)
              setAviso(
                "Se cortó una llamada al salir de la página. Quedó en el historial del ticket.",
              );
          }
          pausa = (datos?.esperar ?? 3) * 1_000;
          const entrante = datos?.entrantes?.[0];
          if (vigente && entrante && !faseRef.current) {
            focoPrevio.current = document.activeElement;
            setLlamada(entrante);
            setFase("entrante");
            setAviso(null);
            setAnuncio(
              `${entrante.otro} le está llamando por el ticket ${entrante.ticket_numero}.`,
            );
          }
        } catch {
          // Se reintenta en la siguiente vuelta.
        }
        primera = false;
      }
      const oculta = document.visibilityState === "hidden";
      espera = setTimeout(buscar, oculta ? Math.max(pausa, 6_000) : pausa);
    };
    buscar();
    return () => {
      vigente = false;
      clearTimeout(espera);
    };
  }, [colgarEnServidor]);

  // Mientras llama, mientras suena o durante la llamada: el estado del otro
  // lado (contestó, rechazó, colgó). Cada consulta es un «sigo aquí».
  const idLlamada = llamada?.id;
  useEffect(() => {
    if (!idLlamada || !fase) return undefined;
    const seguir = setInterval(async () => {
      try {
        const actual = await soporteService.llamada(idLlamada);
        if (faseRef.current === "llamando" && actual.estado === "en_curso") {
          await conexion.current?.setRemoteDescription(
            JSON.parse(actual.respuesta),
          );
          setLlamada(actual);
          setFase("en_curso");
          setAnuncio(`${actual.otro} contestó.`);
        } else if (!["sonando", "en_curso"].includes(actual.estado)) {
          const otro = actual.otro;
          const textos = {
            rechazada: `${otro} no contestó. Puede escribirle por el chat del ticket o volver a llamar.`,
            perdida: `${otro} no contestó. Le quedó el aviso en la campana; también puede escribirle por el chat del ticket.`,
            cancelada:
              faseRef.current === "entrante"
                ? `${otro} colgó antes de que contestara.`
                : "La llamada se canceló.",
            terminada: `${otro} colgó. La llamada quedó en el historial del ticket.`,
          };
          limpiar(textos[actual.estado] ?? "La llamada terminó.");
        }
      } catch {
        // Un fallo de red puntual: se reintenta en la siguiente vuelta.
      }
    }, SEGUIR_LLAMADA_MS);
    return () => clearInterval(seguir);
  }, [idLlamada, fase, limpiar]);

  // El tiempo: de la llamada en curso, o el que lleva sonando.
  useEffect(() => {
    if (!["en_curso", "llamando"].includes(fase)) return undefined;
    const intervalo = setInterval(() => setSegundos((s) => s + 1), 1_000);
    return () => clearInterval(intervalo);
  }, [fase]);
  useEffect(() => {
    if (fase === "en_curso") setSegundos(0);
  }, [fase]);

  // En segundo plano, el título de la pestaña avisa de la llamada.
  useEffect(() => {
    if (fase !== "entrante") return undefined;
    const antes = document.title;
    document.title = `Llamada entrante · ${llamada?.ticket_numero ?? ""}`;
    return () => {
      document.title = antes;
    };
  }, [fase, llamada?.ticket_numero]);

  // Salir de la página a mitad de llamada: se pregunta y, si sale, se
  // cuelga (sin esperar al corte por falta de señales).
  useEffect(() => {
    if (!fase) return undefined;
    const preguntar = (evento) => {
      evento.preventDefault();
      evento.returnValue = "";
    };
    const alSalir = () => {
      const id = llamadaRef.current?.id;
      if (id) soporteService.colgarAlSalir(id);
    };
    window.addEventListener("beforeunload", preguntar);
    window.addEventListener("pagehide", alSalir);
    return () => {
      window.removeEventListener("beforeunload", preguntar);
      window.removeEventListener("pagehide", alSalir);
    };
  }, [fase]);

  const timbreSuspendido = useTimbre(fase === "entrante" && !timbreCallado);

  // Al salir del sistema, no queda el micrófono abierto.
  useEffect(() => () => limpiar(), [limpiar]);

  // El aviso final se va solo a los 10 s (los errores se quedan).
  useEffect(() => {
    if (!aviso || fase) return undefined;
    const tope = setTimeout(() => setAviso(null), 10_000);
    return () => clearTimeout(tope);
  }, [aviso, fase]);

  return (
    <LlamadasContext.Provider value={{ llamar, ocupado: Boolean(fase) }}>
      {children}
      {/* El audio del otro: invisible, se reproduce solo. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- es una llamada en vivo */}
      <audio ref={audio} autoPlay />
      {/* Siempre montado: lo que pasa con la llamada se anuncia. */}
      <p className="visually-hidden" aria-live="assertive">
        {anuncio}
      </p>
      {(fase || error || aviso) && (
        <PanelDeLlamada
          llamada={llamada}
          fase={fase}
          segundos={segundos}
          silenciado={silenciado}
          timbreCallado={timbreCallado}
          timbreSuspendido={timbreSuspendido}
          error={error}
          aviso={aviso}
          onContestar={contestar}
          onColgar={colgar}
          onSilenciar={silenciar}
          onCallarTimbre={() => setTimbreCallado(true)}
          onCerrarAviso={() => {
            setError(null);
            setAviso(null);
          }}
        />
      )}
    </LlamadasContext.Provider>
  );
}

function PanelDeLlamada({
  llamada,
  fase,
  segundos,
  silenciado,
  timbreCallado,
  timbreSuspendido,
  error,
  aviso,
  onContestar,
  onColgar,
  onSilenciar,
  onCallarTimbre,
  onCerrarAviso,
}) {
  const colgarRef = useRef(null);
  const cerrarRef = useRef(null);
  // Al contestar, el foco pasa a «Colgar» (el botón pulsado desaparece).
  useEffect(() => {
    if (fase === "en_curso" && document.activeElement === document.body)
      colgarRef.current?.focus();
  }, [fase]);
  // Mientras suena, Escape calla el timbre (no rechaza).
  useEffect(() => {
    if (fase !== "entrante") return undefined;
    const tecla = (e) => {
      if (e.key === "Escape") onCallarTimbre();
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [fase, onCallarTimbre]);
  // Un aviso de error toma el foco solo si nadie lo tiene.
  useEffect(() => {
    if (!fase && error && document.activeElement === document.body)
      cerrarRef.current?.focus();
  }, [fase, error]);

  if (!fase) {
    return (
      <div
        className={`soporte-llamada soporte-llamada--aviso mz-alert ${error ? "mz-alert--bad" : "mz-alert--info"}`}
      >
        <Icon name={error ? "x-octagon" : "telephone"} />
        <span>{error || aviso}</span>
        <button
          ref={cerrarRef}
          type="button"
          className="btn btn-link btn-sm ms-auto"
          onClick={onCerrarAviso}
        >
          Cerrar
        </button>
      </div>
    );
  }

  const otro = llamada?.otro ?? "…";
  const titulo =
    fase === "entrante"
      ? `${otro} le está llamando`
      : fase === "conectando"
        ? `Conectando con ${otro}…`
        : fase === "llamando"
          ? `Llamando a ${otro}…`
          : `En llamada con ${otro}`;

  return (
    <section
      className={`soporte-llamada mz-card${fase === "entrante" ? " soporte-llamada--entrante" : ""}`}
      aria-labelledby="llamada-titulo"
      aria-describedby="llamada-detalle"
    >
      <div className="mz-card-body">
        <h2 id="llamada-titulo" className="h6 mb-1 soporte-llamada__titulo">
          <Icon name={fase === "en_curso" ? "telephone-fill" : "telephone"} />{" "}
          {titulo}
          {fase === "en_curso" && (
            <span className="soporte-llamada__reloj" aria-live="off">
              {reloj(segundos)}
            </span>
          )}
        </h2>
        <p id="llamada-detalle" className="mz-small mz-faint mb-2">
          {llamada?.ticket_numero ? (
            <>
              Ticket{" "}
              <Link to={llamada.enlace_ticket}>{llamada.ticket_numero}</Link>
              {fase === "llamando" && (
                <>
                  {" "}
                  · Sonando… se corta a los {SEGUNDOS_DE_TIMBRE} s (
                  {Math.max(0, SEGUNDOS_DE_TIMBRE - segundos)} s)
                </>
              )}
            </>
          ) : (
            "Preparando el micrófono…"
          )}
        </p>
        {fase === "entrante" && timbreSuspendido && !timbreCallado && (
          <p className="mz-small mb-2">
            (Sin sonido: haga clic en la página para activar el timbre.)
          </p>
        )}
        {fase === "en_curso" && silenciado && (
          <p className="mz-small mb-2 soporte-llamada__silenciado">
            <Icon name="mic-mute-fill" /> Su micrófono está silenciado.
          </p>
        )}
        <div className="mz-actions">
          {fase === "entrante" && (
            <button
              type="button"
              className="btn btn-success"
              onClick={onContestar}
            >
              <Icon name="telephone-fill" /> Contestar
            </button>
          )}
          {fase === "conectando" && (
            <button
              type="button"
              className="btn btn-success"
              aria-disabled="true"
              aria-busy="true"
            >
              <span
                className="spinner-border spinner-border-sm"
                aria-hidden="true"
              />{" "}
              Conectando…
            </button>
          )}
          {fase === "entrante" && (
            <button
              type="button"
              className="btn btn-outline-secondary"
              aria-pressed={timbreCallado}
              onClick={onCallarTimbre}
            >
              <Icon name="bell-slash" /> Silenciar timbre
            </button>
          )}
          {fase === "en_curso" && (
            <button
              type="button"
              className="btn btn-outline-secondary"
              aria-pressed={silenciado}
              onClick={onSilenciar}
            >
              <Icon name={silenciado ? "mic-mute-fill" : "mic"} /> Silenciar
              micrófono
            </button>
          )}
          <button
            ref={colgarRef}
            type="button"
            className="btn btn-danger"
            onClick={onColgar}
          >
            <Icon name="telephone-x" />{" "}
            {fase === "entrante" ? "Rechazar" : "Colgar"}
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * El botón «Llamar» del ticket. Sin HTTPS, o con otra llamada en marcha,
 * sigue enfocable y dice por qué no llama.
 */
export function BotonLlamar({ ticketId, nombre, paraQuienPide = false }) {
  const llamadas = useLlamadas();
  if (!llamadas) return null;
  const sinHttps = !sePuedeLlamar();
  const motivo = sinHttps
    ? paraQuienPide
      ? "Las llamadas aún no están disponibles. Mientras tanto, use el chat del ticket."
      : "Las llamadas necesitan que el sistema se abra con HTTPS (lo está configurando TI)."
    : llamadas.ocupado
      ? "Ya está en una llamada."
      : null;
  return (
    <span className="soporte-llamar">
      <button
        type="button"
        className="btn btn-outline-primary btn-sm"
        aria-disabled={motivo ? "true" : undefined}
        aria-describedby={motivo ? `llamar-motivo-${ticketId}` : undefined}
        onClick={() => {
          if (!motivo) llamadas.llamar(ticketId, nombre);
        }}
      >
        <Icon name="telephone" /> Llamar a {nombre}
      </button>
      {motivo && (
        <span
          id={`llamar-motivo-${ticketId}`}
          className="mz-small mz-faint d-block"
        >
          {motivo}
        </span>
      )}
    </span>
  );
}
