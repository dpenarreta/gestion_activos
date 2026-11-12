/*
 * El detalle de un llamado con su historial y el correo según su estado, y
 * las acciones de Gestión Humana: confirmar uno solicitado (pudiendo ajustar
 * nivel, monto y descripción, con un paso de revisión antes de emitir),
 * rechazarlo con un motivo y anular uno emitido con un motivo. Qué botones
 * salen lo dice el servidor en `puede`; él vuelve a autorizar cada acción.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { llamadosService } from "../../../api/llamadosService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { useAuth } from "../../../hooks/useAuth";
import { formatearMoneda } from "../../../utils/formato";
import {
  erroresPorCampo,
  hayErroresGenerales,
  mensajeDeError,
} from "../../../utils/errores";
import { useVisorDeAdjuntos } from "../../Soporte/VisorAdjunto";
import { ErrorEnLinea, fecha, fechaHora } from "../comunes";
import { CamposDeNivel } from "./CamposDeNivel";
import { HistorialDeLaPersona } from "./HistorialDeLaPersona";
import {
  SANCION,
  TIPOS,
  causaDe,
  comoPersona,
  avisoDeEmision,
  idDe,
  jefeDe,
  montoANumero,
  nivelDe,
  nivelPropuesto,
  nivelesDe,
  nombreDe,
  personaDe,
  propuestoDe,
  tipoDe,
} from "./llamadosComunes";
import { PildoraEstado } from "./Piezas";
import { RevisionDeEmision } from "./RevisionDeEmision";

const ACCION = {
  solicitado: "Solicitó",
  solicitud: "Solicitó",
  emitido: "Emitió",
  emision: "Emitió",
  confirmado: "Confirmó",
  confirmacion: "Confirmó",
  rechazado: "Rechazó",
  rechazo: "Rechazó",
  anulado: "Anuló",
  anulacion: "Anuló",
};

const comoLista = (valor) =>
  (Array.isArray(valor) ? valor : valor ? [valor] : [])
    .map(nombreDe)
    .join(", ");

/** Pide un motivo (rechazar o anular): obligatorio. */
function DialogoDeMotivo({
  titulo,
  subtitulo,
  aviso,
  etiqueta,
  textoConfirmar,
  textoGuardando,
  onCerrar,
  onEnviar,
}) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const contenedor = useRef(null);

  async function enviar(evento) {
    evento.preventDefault();
    setError(null);
    if (!motivo.trim()) {
      setErrores({ motivo: "Indique el motivo." });
      enfocarPrimerError(contenedor.current);
      return;
    }
    setErrores({});
    setGuardando(true);
    try {
      await onEnviar(motivo.trim());
    } catch (err) {
      setErrores(erroresPorCampo(err));
      setError(
        hayErroresGenerales(err) || !Object.keys(erroresPorCampo(err)).length
          ? mensajeDeError(err, "No se pudo completar la acción.")
          : "Revise el campo marcado.",
      );
      enfocarPrimerError(contenedor.current);
      setGuardando(false);
    }
  }

  return (
    <ModalDialog
      titulo={titulo}
      subtitulo={subtitulo}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar={textoConfirmar}
      textoGuardando={textoGuardando}
      isSaving={guardando}
      variante="danger"
      noValidate
      textoCancelar="Volver"
    >
      <div className="mz-stack" ref={contenedor}>
        <LeyendaObligatorios />
        {aviso && (
          <p className="mz-alert mz-alert--info mb-0" role="status">
            <Icon name="info-circle" /> {aviso}
          </p>
        )}
        {error && <ErrorEnLinea mensaje={error} />}
        <Campo
          id="llamado-motivo"
          etiqueta={etiqueta}
          obligatorio
          error={errores.motivo}
        >
          <textarea
            className="form-control"
            rows={3}
            value={motivo}
            data-autofocus
            disabled={guardando}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </Campo>
      </div>
    </ModalDialog>
  );
}

/**
 * Confirma un llamado solicitado, con los ajustes que Gestión Humana quiera.
 * El nivel propuesto es el vigente (con los llamados de hoy), no el de cuando
 * se pidió: si no lo cambia, no se envía `nivel` y el servidor aplica el suyo.
 */
function DialogoConfirmar({ llamado, causa, onCerrar, onEnviar }) {
  const { user } = useAuth();
  const niveles = nivelesDe(causa);
  const vigente =
    llamado.propuesta_vigente && typeof llamado.propuesta_vigente === "object"
      ? llamado.propuesta_vigente
      : null;
  const [calculada, setCalculada] = useState(null);
  const [errorHistorial, setErrorHistorial] = useState(null);
  const [vez, setVez] = useState(0);
  // El nivel vigente que se muestra: el del detalle y, tras un 409
  // (`propuesta_cambio`), el que acaba de calcular el servidor.
  const [vigenteId, setVigenteId] = useState(() => propuestoDe(llamado));
  const [avisoCambio, setAvisoCambio] = useState(null);
  const propuestoId = vigenteId;
  // La propuesta pedida aparte manda sobre la del detalle (que puede no traer
  // el historial).
  const fuente = calculada ?? vigente;
  const historial = fuente?.historial ?? null;
  const [paso, setPaso] = useState("formulario");
  const [nivelId, setNivelId] = useState(
    propuestoId === null ? "" : String(propuestoId),
  );
  const [justificacion, setJustificacion] = useState("");
  const [monto, setMonto] = useState(() => {
    if (llamado.monto !== null && llamado.monto !== undefined) {
      return String(llamado.monto);
    }
    // El nivel vigente puede ser una sanción que al solicitarse no lo era.
    const sugerido = niveles.find(
      (n) => String(n.id) === String(propuestoId),
    )?.monto_sugerido;
    return sugerido === null || sugerido === undefined ? "" : String(sugerido);
  });
  const [descripcion, setDescripcion] = useState(llamado.descripcion ?? "");
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const contenedor = useRef(null);
  const persona = personaDe(llamado);
  const personaId = idDe(persona);
  const causaId = idDe(causaDe(llamado));

  // Sin el historial vigente en el detalle, se pide aparte.
  useEffect(() => {
    if (historial !== null || !personaId || !causaId) return undefined;
    let activo = true;
    setErrorHistorial(null);
    llamadosService
      .propuesta(personaId, causaId, {
        fechaHecho: llamado.fecha_hecho,
        modo: "emitir",
      })
      .then((datos) => {
        if (!activo) return;
        setCalculada(datos);
        const id = nivelPropuesto(datos);
        if (id !== null) {
          setVigenteId((actual) => actual ?? id);
          setNivelId((actual) => actual || String(id));
        }
      })
      .catch((err) => {
        if (activo) {
          setErrorHistorial(
            mensajeDeError(err, "No se pudo cargar el historial vigente."),
          );
        }
      });
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vez]);

  const nivelElegido = niveles.find((n) => String(n.id) === String(nivelId));
  const cambia =
    propuestoId !== null && String(nivelId) !== String(propuestoId);
  const nombrePersona = nombreDe(persona);

  function elegirNivel(id) {
    setNivelId(id);
    const nivel = niveles.find((n) => String(n.id) === String(id));
    if (nivel?.tipo === SANCION && nivel.monto_sugerido != null) {
      setMonto(String(nivel.monto_sugerido));
    }
  }

  function revisar(evento) {
    evento.preventDefault();
    setError(null);
    const faltan = {};
    if (niveles.length && !nivelElegido) faltan.nivel = "Elija el nivel.";
    if (cambia && !justificacion.trim()) {
      faltan.justificacion_cambio = "Justifique el cambio de nivel.";
    }
    if (nivelElegido?.tipo === SANCION && montoANumero(monto) === null) {
      faltan.monto = "Indique un monto válido, por ejemplo 10,50.";
    }
    if (!descripcion.trim()) faltan.descripcion = "Describa el hecho.";
    setErrores(faltan);
    if (Object.keys(faltan).length) {
      enfocarPrimerError(contenedor.current);
      return;
    }
    setPaso("revision");
  }

  /** El nivel vigente cambió mientras se revisaba: se vuelve a calcular y se
   * muestra la revisión con el nivel nuevo y un aviso. */
  async function recalcular() {
    try {
      const datos = await llamadosService.propuesta(personaId, causaId, {
        fechaHecho: llamado.fecha_hecho,
        modo: "emitir",
      });
      const nuevo = nivelPropuesto(datos);
      setCalculada(datos);
      if (nuevo !== null) {
        setVigenteId(nuevo);
        const nivel = niveles.find((n) => String(n.id) === String(nuevo));
        if (!cambia) {
          setNivelId(String(nuevo));
          if (nivel?.tipo === SANCION && nivel.monto_sugerido != null) {
            setMonto(String(nivel.monto_sugerido));
          }
        }
        setAvisoCambio(
          `El nivel vigente cambió mientras revisaba: ahora es «${nombreDe(nivel ?? datos.nivel_propuesto)}». Revise de nuevo antes de emitir.`,
        );
      }
      setError(null);
    } catch (err) {
      setError(
        mensajeDeError(
          err,
          "El nivel vigente cambió y no se pudo recalcular. Cierre e intente de nuevo.",
        ),
      );
    } finally {
      setGuardando(false);
    }
  }

  // Un error de campo llegado durante la revisión: al volver al formulario,
  // el foco va al primer campo con error.
  useEffect(() => {
    if (paso === "formulario" && Object.keys(errores).length) {
      enfocarPrimerError(contenedor.current);
    }
    // Solo al volver de un paso a otro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso]);

  async function enviar(evento) {
    evento.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      await onEnviar({
        descripcion: descripcion.trim(),
        // El nivel vigente que se le mostró: si cambió, el servidor responde
        // 409 `propuesta_cambio` en vez de emitir otro distinto.
        ...(propuestoId !== null ? { nivel_esperado: propuestoId } : {}),
        // Sin cambio, el servidor aplica el nivel vigente por su cuenta.
        ...(cambia
          ? { nivel: nivelId, justificacion_cambio: justificacion.trim() }
          : {}),
        ...(nivelElegido?.tipo === SANCION
          ? { monto: montoANumero(monto) }
          : {}),
      });
    } catch (err) {
      if (
        err?.response?.status === 409 &&
        err.response.data?.error?.code === "propuesta_cambio"
      ) {
        await recalcular();
        return;
      }
      const campos = erroresPorCampo(err);
      setErrores(campos);
      setError(
        hayErroresGenerales(err) || !Object.keys(campos).length
          ? mensajeDeError(err, "No se pudo confirmar el llamado.")
          : "Revise los campos marcados.",
      );
      if (Object.keys(campos).length) setPaso("formulario");
      enfocarPrimerError(contenedor.current);
      setGuardando(false);
    }
  }

  const titulo = `Confirmar llamado a ${nombrePersona}`;
  // Con ajustes hechos, cerrar pregunta «¿Descartar?» también al volver de la
  // revisión.
  const sucio =
    descripcion !== (llamado.descripcion ?? "") ||
    Boolean(justificacion.trim()) ||
    cambia;

  if (paso === "revision" && nivelElegido) {
    return (
      <RevisionDeEmision
        titulo={titulo}
        persona={
          typeof persona === "object" && persona
            ? comoPersona(persona)
            : { full_name: nombrePersona }
        }
        causa={nombreDe(causaDe(llamado))}
        nivel={nivelElegido}
        monto={monto}
        fechaHecho={llamado.fecha_hecho}
        descripcion={descripcion}
        jefe={jefeDe(fuente)}
        personaTieneCorreo={fuente?.persona_tiene_correo}
        aviso={avisoCambio}
        emitidoPor={user?.full_name ?? user?.name}
        guardando={guardando}
        error={error}
        onVolver={() => {
          setError(null);
          setAvisoCambio(null);
          setPaso("formulario");
        }}
        onEmitir={enviar}
      />
    );
  }

  return (
    <ModalDialog
      titulo={titulo}
      subtitulo="Queda emitido y se notifica a la persona si el nivel envía correo. Puede ajustarlo antes; verá un resumen antes de emitir."
      onCerrar={onCerrar}
      onSubmit={revisar}
      textoConfirmar="Revisar y emitir"
      isSaving={guardando}
      sucio={sucio}
      puedeConfirmar={historial !== null}
      noValidate
      anchoMaximo="40rem"
    >
      <div className="mz-stack" ref={contenedor}>
        <LeyendaObligatorios />
        {error && <ErrorEnLinea mensaje={error} />}
        {historial === null && !errorHistorial && (
          <p className="mz-small mz-faint mb-0" role="status">
            Cargando el historial vigente…
          </p>
        )}
        {errorHistorial && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <span className="flex-grow-1">{errorHistorial}</span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm mz-tactil"
              onClick={() => setVez((v) => v + 1)}
            >
              Reintentar
            </button>
          </div>
        )}
        {historial !== null && (
          <HistorialDeLaPersona
            historial={historial}
            plazoMeses={
              causa?.plazo_reincidencia_meses ?? causa?.plazo_reincidencia
            }
          />
        )}
        <CamposDeNivel
          prefijo="confirmar"
          niveles={niveles}
          propuestoId={propuestoId}
          nivelId={nivelId}
          onNivel={elegirNivel}
          justificacion={justificacion}
          onJustificacion={setJustificacion}
          monto={monto}
          onMonto={setMonto}
          errores={errores}
          deshabilitado={guardando}
        />
        <Campo
          id="confirmar-descripcion"
          etiqueta="Descripción del hecho"
          obligatorio
          error={errores.descripcion}
        >
          <textarea
            className="form-control"
            rows={4}
            value={descripcion}
            disabled={guardando}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </Campo>
      </div>
    </ModalDialog>
  );
}

function Dato({ etiqueta, children }) {
  return (
    <div>
      <dt className="mz-small mz-faint">{etiqueta}</dt>
      <dd className="mb-0">{children}</dd>
    </div>
  );
}

/** El correo del llamado según el estado del envío. */
function SeccionCorreo({ llamado, onReenviar, envio }) {
  const correo = llamado.correo ?? null;
  const estado =
    correo?.estado ??
    (correo ? (correo.enviado ? "enviado" : "no_aplica") : "no_aplica");
  const texto = correo?.estado_display;
  let contenido;
  if (estado === "enviado") {
    contenido = (
      <div className="mz-small">
        <p className="mb-1">
          {texto ?? "Enviado"}
          {correo.fecha && ` · ${fechaHora(correo.fecha)}`}
        </p>
        {correo.para && (
          <p className="mb-1">
            <strong>Para:</strong> {comoLista(correo.para)}
          </p>
        )}
        {correo.copia && comoLista(correo.copia) && (
          <p className="mb-1">
            <strong>Con copia a:</strong> {comoLista(correo.copia)}
          </p>
        )}
        {correo.asunto && (
          <p className="mb-1">
            <strong>Asunto:</strong> {correo.asunto}
          </p>
        )}
        {correo.cuerpo && (
          <p className="mb-0" style={{ whiteSpace: "pre-wrap" }}>
            {correo.cuerpo}
          </p>
        )}
      </div>
    );
  } else if (estado === "fallido") {
    contenido = (
      <p className="mz-alert mz-alert--bad mb-0" role="alert">
        <Icon name="x-octagon" />
        <span>
          El correo no se pudo enviar. Notifique a la persona por otro medio.
        </span>
      </p>
    );
  } else if (estado === "sin_direccion") {
    contenido = (
      <p className="mz-alert mz-alert--warn mb-0" role="status">
        <Icon name="exclamation-triangle" />
        <span>
          La persona no tiene un correo registrado, así que no se envió.
          Notifíquela por otro medio.
        </span>
      </p>
    );
  } else if (estado === "pendiente") {
    contenido = (
      <p className="mz-alert mz-alert--warn mb-0" role="status">
        <Icon name="hourglass-split" />
        <span>El correo está por enviarse…</span>
      </p>
    );
  } else if (llamado.estado === "solicitado") {
    contenido = (
      <p className="mz-faint mz-small mb-0">
        Se enviará al confirmar, si el nivel lo indica.
      </p>
    );
  } else {
    contenido = (
      <p className="mz-faint mz-small mb-0">
        {llamado.estado === "emitido"
          ? "Este nivel no envía correo; el hecho solo quedó registrado."
          : "No se envió correo con este llamado."}
      </p>
    );
  }
  return (
    <section aria-labelledby="llamado-correo-titulo">
      <h4 id="llamado-correo-titulo" className="h6">
        Correo
      </h4>
      {contenido}
      {envio && (
        <p
          className={`mz-alert mz-alert--${envio.tono ?? "ok"} mt-2 mb-0`}
          role="status"
        >
          {envio.texto}
        </p>
      )}
      {llamado.puede?.reenviar && (
        <div className="mt-2">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm mz-tactil"
            onClick={onReenviar}
          >
            <Icon name="envelope-arrow-up" /> Reenviar correo
          </button>
        </div>
      )}
    </section>
  );
}

/** Confirma el reenvío del correo: llega de nuevo a la persona. */
function DialogoReenviar({ nombre, onCerrar, onEnviar }) {
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  async function enviar(evento) {
    evento.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      await onEnviar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo reenviar el correo."));
      setGuardando(false);
    }
  }

  return (
    <ModalDialog
      titulo="Reenviar correo"
      subtitulo={`Se enviará de nuevo el correo del llamado a ${nombre}.`}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar="Reenviar correo"
      textoGuardando="Reenviando…"
      textoCancelar="Volver"
      isSaving={guardando}
      sinPreguntarAlDescartar
    >
      {error && <ErrorEnLinea mensaje={error} />}
      <p className="mb-0">
        La persona recibirá el mismo mensaje otra vez. ¿Desea continuar?
      </p>
    </ModalDialog>
  );
}

/** El resultado de un reenvío, dicho según el estado que devuelve. */
function avisoDeReenvio(respuesta) {
  const estado = respuesta?.correo?.estado;
  if (estado === "fallido") {
    return {
      tono: "bad",
      texto:
        "El correo no se pudo enviar de nuevo. Notifique a la persona por otro medio.",
    };
  }
  if (estado === "sin_direccion") {
    return {
      tono: "warn",
      texto:
        "La persona no tiene correo registrado, así que no se envió. Notifíquela por otro medio.",
    };
  }
  if (estado === "pendiente") {
    return { tono: "warn", texto: "El correo está por enviarse…" };
  }
  return { tono: "ok", texto: "El correo se reenvió." };
}

export function DetalleLlamado({ id, causas, onCerrar, onCambio }) {
  const [llamado, setLlamado] = useState(null);
  const [error, setError] = useState(null);
  const [vez, setVez] = useState(0);
  const [dialogo, setDialogo] = useState(null);
  const [envio, setEnvio] = useState(null);
  const visor = useVisorDeAdjuntos();

  const cargar = useCallback(() => {
    setError(null);
    return llamadosService
      .llamado(id)
      .then(setLlamado)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar el llamado.")),
      );
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar, vez]);

  const causa =
    causas.find((c) => String(c.id) === String(idDe(causaDe(llamado ?? {})))) ??
    (llamado && typeof causaDe(llamado) === "object" ? causaDe(llamado) : null);
  const tipo = llamado ? tipoDe(llamado) : null;
  const historial = llamado?.historial ?? [];
  const puede = llamado?.puede ?? {};
  const adjunto = llamado?.adjunto;
  const rechazado = llamado?.estado === "rechazado";
  const anulado = llamado?.estado === "anulado";

  // Tras la acción se cierra el detalle: el éxito lo dice la lista. Al
  // emitir, si el correo no salió, el aviso es de advertencia y lo dice.
  async function ejecutar(accion, mensaje, conCorreo = false) {
    const respuesta = await accion();
    setDialogo(null);
    onCambio(
      conCorreo ? avisoDeEmision(respuesta, mensaje) : { texto: mensaje },
    );
    onCerrar();
  }

  const quien = (por, en) =>
    [por && nombreDe(por), en && fechaHora(en)].filter(Boolean).join(" · ");

  return (
    <>
      <ModalDialog
        titulo={
          llamado
            ? `Llamado de atención${llamado.numero ? ` N.º ${llamado.numero}` : ""} a ${nombreDe(personaDe(llamado))}`
            : "Llamado de atención"
        }
        onCerrar={onCerrar}
        textoCancelar="Cerrar"
        anchoMaximo="46rem"
      >
        <EstadoDeCarga
          cargando={!llamado && !error}
          error={error}
          onReintentar={() => setVez((v) => v + 1)}
        />
        {llamado && (
          <div className="mz-stack">
            <div className="d-flex flex-wrap gap-2 align-items-center">
              <PildoraEstado estado={llamado.estado} />
              {puede.confirmar && (
                <button
                  type="button"
                  className="btn btn-primary mz-tactil"
                  onClick={() => setDialogo("confirmar")}
                >
                  <Icon name="check2-circle" /> Confirmar
                </button>
              )}
              {puede.rechazar && (
                <button
                  type="button"
                  className="btn btn-outline-danger mz-tactil"
                  onClick={() => setDialogo("rechazar")}
                >
                  <Icon name="x-circle" /> Rechazar
                </button>
              )}
              {puede.anular && (
                <button
                  type="button"
                  className="btn btn-outline-danger mz-tactil"
                  onClick={() => setDialogo("anular")}
                >
                  <Icon name="slash-circle" /> Anular
                </button>
              )}
            </div>
            <dl className="d-grid gap-2 mb-0">
              {llamado.numero && <Dato etiqueta="N.º">{llamado.numero}</Dato>}
              <Dato etiqueta="Causa">{nombreDe(causaDe(llamado))}</Dato>
              <Dato etiqueta="Nivel">
                {nombreDe(nivelDe(llamado))}
                {tipo && ` (${TIPOS[tipo] ?? tipo})`}
              </Dato>
              {llamado.justificacion_cambio && (
                <Dato etiqueta="Justificación del cambio de nivel">
                  {llamado.justificacion_cambio}
                </Dato>
              )}
              <Dato etiqueta="Fecha del hecho">
                {fecha(llamado.fecha_hecho)}
              </Dato>
              <Dato etiqueta="Descripción">
                <span style={{ whiteSpace: "pre-wrap" }}>
                  {llamado.descripcion}
                </span>
              </Dato>
              {tipo === SANCION && (
                <Dato etiqueta="Monto">{formatearMoneda(llamado.monto)}</Dato>
              )}
              {rechazado && (
                <Dato etiqueta="Motivo del rechazo">
                  {llamado.motivo_rechazo ?? llamado.motivo}
                  <div className="mz-small mz-faint">
                    {quien(llamado.rechazado_por, llamado.rechazado_en)}
                  </div>
                </Dato>
              )}
              {anulado && (
                <Dato etiqueta="Motivo de la anulación">
                  {llamado.motivo_anulacion ?? llamado.motivo}
                  <div className="mz-small mz-faint">
                    {quien(llamado.anulado_por, llamado.anulado_en)}
                  </div>
                </Dato>
              )}
              {llamado.solicitado_por && (
                <Dato etiqueta="Solicitado por">
                  {nombreDe(llamado.solicitado_por)}
                </Dato>
              )}
              {llamado.emitido_por && (
                <Dato etiqueta="Emitido por">
                  {nombreDe(llamado.emitido_por)}
                </Dato>
              )}
              {llamado.notificado_en && (
                <Dato etiqueta="Notificado a la persona">
                  {fechaHora(llamado.notificado_en)}
                </Dato>
              )}
              {adjunto && (
                <Dato etiqueta="Evidencia">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm mz-tactil"
                    disabled={visor.abriendo === "evidencia"}
                    onClick={() =>
                      visor.abrir({
                        id: "evidencia",
                        nombre: adjunto.nombre ?? "evidencia",
                        url: adjunto.url,
                      })
                    }
                  >
                    <Icon name="paperclip" /> Ver evidencia
                    <span className="visually-hidden">
                      {" "}
                      ({adjunto.nombre ?? "archivo adjunto"})
                    </span>
                  </button>
                </Dato>
              )}
            </dl>
            {visor.error && <ErrorEnLinea mensaje={visor.error} />}

            <section aria-labelledby="llamado-hist-titulo">
              <h4 id="llamado-hist-titulo" className="h6">
                Historial
              </h4>
              {historial.length ? (
                <ol className="mz-small mb-0">
                  {historial.map((h, i) => (
                    <li key={h.id ?? i}>
                      {fechaHora(h.fecha ?? h.creado)} ·{" "}
                      {h.accion_display ?? ACCION[h.accion] ?? h.accion}{" "}
                      {nombreDe(h.usuario)}
                      {h.detalle || h.comentario || h.motivo
                        ? `: ${h.detalle ?? h.comentario ?? h.motivo}`
                        : ""}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mz-faint mz-small mb-0">Sin movimientos.</p>
              )}
            </section>

            <SeccionCorreo
              llamado={llamado}
              envio={envio}
              onReenviar={() => setDialogo("reenviar")}
            />
          </div>
        )}
      </ModalDialog>
      {visor.visor}

      {dialogo === "confirmar" && llamado && (
        <DialogoConfirmar
          llamado={llamado}
          causa={causa}
          onCerrar={() => setDialogo(null)}
          onEnviar={(campos) =>
            ejecutar(
              () => llamadosService.confirmar(id, campos),
              "El llamado quedó emitido.",
              true,
            )
          }
        />
      )}
      {dialogo === "reenviar" && llamado && (
        <DialogoReenviar
          nombre={nombreDe(personaDe(llamado))}
          onCerrar={() => setDialogo(null)}
          onEnviar={async () => {
            const respuesta = await llamadosService.reenviarCorreo(id);
            setDialogo(null);
            await cargar();
            setEnvio(avisoDeReenvio(respuesta));
          }}
        />
      )}
      {dialogo === "rechazar" && (
        <DialogoDeMotivo
          titulo="Rechazar solicitud"
          subtitulo="El jefe que lo pidió recibe el motivo en la campana."
          etiqueta="Motivo del rechazo"
          textoConfirmar="Rechazar"
          textoGuardando="Rechazando…"
          onCerrar={() => setDialogo(null)}
          onEnviar={(motivo) =>
            ejecutar(
              () => llamadosService.rechazar(id, motivo),
              "La solicitud quedó rechazada.",
            )
          }
        />
      )}
      {dialogo === "anular" && (
        <DialogoDeMotivo
          titulo="Anular llamado"
          subtitulo="Deja de contar para la reincidencia. Esta acción queda en la auditoría."
          aviso={
            llamado?.notificado_en
              ? "Se avisará a la persona de la anulación, porque ya se le había notificado este llamado."
              : "No se avisará a la persona: nunca se le notificó este llamado."
          }
          etiqueta="Motivo de la anulación"
          textoConfirmar="Anular llamado"
          textoGuardando="Anulando…"
          onCerrar={() => setDialogo(null)}
          onEnviar={(motivo) =>
            ejecutar(
              () => llamadosService.anular(id, motivo),
              "El llamado quedó anulado.",
            )
          }
        />
      )}
    </>
  );
}
