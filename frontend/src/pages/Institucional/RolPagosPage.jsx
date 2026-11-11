import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { nominaService } from "../../api/nominaService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import {
  erroresPorCampo,
  leerErrorDeBlob,
  mensajeDeError,
} from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import "./Institucional.css";
import { AdjuntosObservacion } from "./AdjuntosObservacion";
import { DescargaMasivaRolPagos } from "./DescargaMasivaRolPagos";
import { HabilitadosRolPagos } from "./HabilitadosRolPagos";
import { ConstanciaRol } from "./ConstanciaRol";
import { SeguimientoRolPagos } from "./SeguimientoRolPagos";
import { HistorialRolPagos } from "./HistorialRolPagos";
import { VisorRolPagos } from "./VisorRolPagos";
import { AuditadoRolPagos } from "./AuditadoRolPagos";
import { confirmar } from "../../components/common/Confirmar/confirmar";

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

/** El período pedido en la dirección (`?anio=&mes=`), o `null`. */
function periodoPedido(busqueda) {
  const pedido = new URLSearchParams(busqueda);
  const anio = Number(pedido.get("anio"));
  const mes = Number(pedido.get("mes"));
  return anio && mes >= 1 && mes <= 12 ? { anio, mes } : null;
}

/** Si la consulta respondió que no hay rol de ese mes. */
function esSinRol(err) {
  return err?.response?.status === 404;
}

/** El detalle de un error que llega como blob (la consulta pide un PDF). */
async function errorDeBlob(err, porDefecto) {
  const leido = await leerErrorDeBlob(err);
  const json = leido?.response?.data;
  if (json && typeof json === "object" && !(json instanceof Blob)) {
    const detalle =
      json?.error?.message ??
      json?.detail ??
      Object.values(json?.error?.details ?? {}).flat()[0];
    if (detalle) return String(detalle);
  }
  return mensajeDeError(leido, porDefecto);
}

function Ventana({ titulo, onCerrar, children }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>{titulo}</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body">{children}</div>
      </div>
    </div>
  );
}

/** Lo que dijo el servidor, sin el nombre del campo delante («Su cuenta no
 * tiene un correo…» y no «codigo_verificacion: Su cuenta…»). */
function mensajeSinCampos(err, porDefecto) {
  const textos = Object.values(erroresPorCampo(err));
  return textos.length ? textos.join(" ") : mensajeDeError(err, porDefecto);
}

/** Los segundos que pide esperar un 429: `details.retry_after` o la cabecera
 * `Retry-After`. */
function segundosDeEspera(err, porDefecto = 60) {
  const valor = Number(
    err?.response?.data?.error?.details?.retry_after ??
      err?.response?.headers?.["retry-after"],
  );
  return Number.isFinite(valor) && valor > 0 ? Math.ceil(valor) : porDefecto;
}

/** «45 segundos» o, desde el minuto, «20 minutos» (el límite por hora da
 * esperas largas: «1200 segundos» no se lee). */
function tiempoDeEspera(segundos) {
  if (segundos < 60) {
    return segundos === 1 ? "1 segundo" : `${segundos} segundos`;
  }
  const minutos = Math.ceil(segundos / 60);
  return minutos === 1 ? "1 minuto" : `${minutos} minutos`;
}

/** La hora a la que vence el código, «10:42» (QA-UX, US-002, 11/11/2026: una
 * hora se compara con el reloj; «10 minutos» no dice desde cuándo). */
function horaDeVencimiento(segundos) {
  return new Date(Date.now() + segundos * 1000).toLocaleTimeString("es-EC", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * La espera para pedir otro código: los segundos que faltan, cómo empezarla y
 * un aviso que cambia solo al terminar (para `aria-live`: anunciar cada
 * segundo abrumaría al lector de pantalla).
 */
function useEsperaDeReenvio() {
  const [hasta, setHasta] = useState(0);
  const [restantes, setRestantes] = useState(0);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    if (!hasta) return undefined;
    const contar = () => {
      const quedan = Math.max(0, Math.ceil((hasta - Date.now()) / 1000));
      setRestantes(quedan);
      if (quedan === 0) {
        setHasta(0);
        setAviso("Ya puede pedir otro código.");
      }
    };
    const intervalo = setInterval(contar, 1000);
    return () => clearInterval(intervalo);
  }, [hasta]);

  function iniciar(segundos) {
    setAviso("");
    setRestantes(segundos);
    setHasta(Date.now() + segundos * 1000);
  }

  return { restantes, iniciar, aviso };
}

/** Solo los dígitos, hasta 6: «Código: 123 456» queda «123456». */
function soloDigitos(texto) {
  return (texto ?? "").replace(/\D/g, "").slice(0, 6);
}

/**
 * Aceptar los términos y confirmar con un código que llega al correo de la
 * cuenta (US-002, 11/11/2026: reemplaza a la contraseña de la cuenta; el
 * código solo lo recibe la persona). Dos pasos en la misma ventana: los
 * términos y «Enviarme el código»; luego el código de 6 dígitos y
 * «Confirmar», que abre el rol. El código está atado al período y a los
 * términos aceptados: para cambiarlos se cierra la ventana y se pide otro.
 */
function Confirmar({
  estado,
  periodo,
  onVisto,
  onSinRol,
  onCerrar,
  onCambiarPeriodo,
  onPeriodoCambiado,
}) {
  const [acepto, setAcepto] = useState(false);
  const [paso, setPaso] = useState("terminos");
  const [envio, setEnvio] = useState(null);
  const [codigo, setCodigo] = useState("");
  // `{ texto, porEspera }`: el aviso de arriba, solo para errores. El del
  // límite por hora (`porEspera`) se quita al terminar la espera: si no,
  // quedaría diciendo que espere cuando ya puede pedir otro.
  const [error, setError] = useState(null);
  const [errorCodigo, setErrorCodigo] = useState(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [consultando, setConsultando] = useState(false);
  const [enfocar, setEnfocar] = useState(0);
  const espera = useEsperaDeReenvio();
  const campoRef = useRef(null);
  const formRef = useRef(null);
  const idEnvio = useId();
  const idPaso = useId();
  // El período del código (QA-FUNC, US-002, 11/11/2026): se fija al pedirlo y
  // es el que se confirma, aunque la página cambie detrás de la ventana.
  const [fijado, setFijado] = useState(null);
  const vigente = fijado ?? periodo;

  // Si el período de la página cambia con el código ya pedido (llega otro
  // `?anio=&mes=` por un aviso, por ejemplo), ese código ya no es del período
  // elegido: se cierra la ventana, como con «Cambiar el período».
  useEffect(() => {
    if (
      fijado &&
      (fijado.anio !== periodo.anio ||
        fijado.mes !== periodo.mes ||
        fijado.codigo !== periodo.codigo)
    ) {
      onPeriodoCambiado();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fijado, periodo.anio, periodo.mes, periodo.codigo]);

  // Al pasar al código y tras un error del código, el foco va al campo.
  useEffect(() => {
    if (enfocar) campoRef.current?.focus();
  }, [enfocar]);

  // Terminó la espera: el aviso del límite ya no vale.
  useEffect(() => {
    if (espera.aviso) setError((e) => (e?.porEspera ? null : e));
  }, [espera.aviso]);

  async function pedirCodigo() {
    setPidiendo(true);
    setError(null);
    setErrorCodigo(null);
    try {
      const respuesta = await nominaService.pedirCodigo({
        ...vigente,
        acepto,
        version: estado.version,
      });
      setFijado({
        anio: vigente.anio,
        mes: vigente.mes,
        codigo: vigente.codigo,
      });
      setEnvio({
        enviadoA: respuesta.enviado_a,
        vence: horaDeVencimiento(respuesta.vence_en ?? 600),
        nuevo: paso === "codigo",
      });
      setCodigo("");
      setPaso("codigo");
      espera.iniciar(respuesta.reenviar_en ?? 60);
      setEnfocar((n) => n + 1);
    } catch (err) {
      const throttled = err?.response?.status === 429;
      const segundos = throttled ? segundosDeEspera(err) : 0;
      // El 429 propio del código trae `details.retry_after`; el genérico del
      // throttle de la vista solo la cabecera Retry-After: ese no dice nada
      // de un código enviado, así que no se pasa al campo (QA-TECH, US-002).
      const delCodigo =
        throttled && err?.response?.data?.error?.details?.retry_after != null;
      // La espera corta entre envíos (reabrió la ventana) no es un error: se
      // dice solo junto a «Enviar otro código». El límite por hora y el
      // genérico sí van arriba. Se decide por los segundos, no por el texto.
      const esperaCorta = delCodigo && segundos <= 60;
      if (!esperaCorta) {
        setError({
          texto: mensajeSinCampos(err, "No se pudo enviar el código."),
          porEspera: throttled,
        });
      }
      if (throttled) {
        espera.iniciar(segundos);
        // Puede que ya tenga un código vigente de este período (cerró la
        // ventana y la volvió a abrir): el campo para escribirlo.
        if (delCodigo && paso === "terminos") {
          setFijado({
            anio: vigente.anio,
            mes: vigente.mes,
            codigo: vigente.codigo,
          });
          setPaso("codigo");
        }
      }
      // El botón pulsado quedó desactivado: el foco va al aviso o, si no
      // hay aviso (espera corta), al campo del código.
      if (esperaCorta) setEnfocar((n) => n + 1);
      else enfocarPrimerError(formRef.current);
    } finally {
      setPidiendo(false);
    }
  }

  async function confirmar() {
    setConsultando(true);
    setError(null);
    setErrorCodigo(null);
    try {
      onVisto(
        await nominaService.consultar({
          ...vigente,
          acepto,
          version: estado.version,
          codigo_verificacion: codigo,
        }),
      );
    } catch (err) {
      if (esSinRol(err)) {
        onSinRol(await errorDeBlob(err, "No hay rol de pagos para ese mes."));
        return;
      }
      const leido = await leerErrorDeBlob(err);
      const delCodigo = erroresPorCampo(leido).codigo_verificacion;
      if (delCodigo) {
        // Junto al campo y con el campo vacío. Se limpia con cualquier error
        // del código (no se decide por el texto): si venció o se agotó, el
        // mensaje dice que pida otro y «Enviar otro código» queda a la mano.
        setErrorCodigo(delCodigo);
        setCodigo("");
        setEnfocar((n) => n + 1);
      } else {
        setError({
          texto: mensajeSinCampos(
            leido,
            "No se pudo consultar el rol de pagos.",
          ),
        });
        // «Confirmar» quedó desactivado: el foco va al aviso.
        enfocarPrimerError(formRef.current);
      }
      setConsultando(false);
    }
  }

  function enviar(evento) {
    evento.preventDefault();
    if (paso === "terminos") pedirCodigo();
    else if (codigo.length === 6) confirmar();
    else {
      // Un botón desactivado no dice por qué (QA-UX, US-002, 11/11/2026).
      // Se vacía y se vuelve a poner en el cuadro siguiente: con el mismo
      // texto, la región aria-live no lo anunciaría otra vez.
      const mensaje = `Escriba los 6 dígitos del código (lleva ${codigo.length}).`;
      setErrorCodigo(null);
      requestAnimationFrame(() => setErrorCodigo(mensaje));
      setEnfocar((n) => n + 1);
    }
  }

  const ocupado = pidiendo || consultando;

  return (
    <Ventana titulo="Confirmar consulta del rol de pagos" onCerrar={onCerrar}>
      {/* Marcar la casilla o escribir el código no son cambios que se
          pierdan al cerrar: no pregunta «¿Descartar cambios?». */}
      <form
        ref={formRef}
        className="mz-stack"
        onSubmit={enviar}
        noValidate
        data-sin-descarte
      >
        <p id={idPaso} className="rol-pagos__paso mb-0">
          {paso === "terminos"
            ? "Paso 1 de 2 · Términos"
            : "Paso 2 de 2 · Código de verificación"}
        </p>
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error.texto}
          </div>
        )}
        <p className="mb-0">
          Rol de pagos de{" "}
          <strong>
            {MESES[vigente.mes - 1]} de {vigente.anio}
          </strong>{" "}
          · código <strong>{vigente.codigo || estado.codigo}</strong>
        </p>
        {paso === "codigo" && (
          <p className="mb-0">
            <button
              type="button"
              className="btn btn-link btn-sm p-0 rol-pagos__cambiar-periodo"
              onClick={onCambiarPeriodo}
            >
              Cambiar el período (pedirá otro código)
            </button>
          </p>
        )}
        {paso === "terminos" ? (
          <>
            <div
              className="rol-pagos__terminos"
              aria-label="Términos y condiciones"
            >
              {estado.terminos}
            </div>
            <label className="form-check">
              <input
                type="checkbox"
                className="form-check-input"
                aria-describedby={idPaso}
                checked={acepto}
                onChange={(e) => setAcepto(e.target.checked)}
              />{" "}
              <span className="form-check-label">
                Acepto los términos y declaro que soy el propietario de este rol
                de pagos.
              </span>
            </label>
            <p className="mz-faint mz-small mb-0">
              Le enviaremos un código de 6 dígitos al correo de su cuenta.
            </p>
            {espera.restantes > 0 && (
              <p className="mz-small mz-faint mb-0">
                Podrá pedir otro código en {tiempoDeEspera(espera.restantes)}.
              </p>
            )}
            <span className="visually-hidden" aria-live="polite">
              {espera.aviso}
            </span>
          </>
        ) : (
          <>
            <div
              id={idEnvio}
              className={`mz-alert ${envio ? "mz-alert--ok" : "mz-alert--info"}`}
              role="status"
            >
              <Icon name={envio ? "envelope-check" : "envelope"} />
              {envio ? (
                <span>
                  {envio.nuevo
                    ? "Le enviamos un código nuevo de 6 dígitos a "
                    : "Le enviamos un código de 6 dígitos a "}
                  <strong>{envio.enviadoA}</strong>. Vence a las {envio.vence}.
                  {envio.nuevo && " El anterior ya no sirve."}
                </span>
              ) : (
                <span>
                  Si ya le llegó un código pedido para{" "}
                  {MESES[vigente.mes - 1].toLowerCase()} de {vigente.anio},
                  escríbalo aquí. Un código pedido para otro período no sirve.
                </span>
              )}
            </div>
            <div>
              <Campo
                id="rol-codigo-verificacion"
                etiqueta="Código de verificación (6 dígitos)"
                obligatorio
                ayuda="Puede tardar hasta un minuto. Revise también la carpeta de correo no deseado. Si ese no es su correo, pídale a Talento Humano que lo actualice."
                error={errorCodigo}
              >
                {/* Sin `maxLength`: el navegador cortaría lo pegado
                    («Código: 123456») antes de quitar lo que no es dígito. */}
                <input
                  ref={campoRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  className="form-control rol-pagos__codigo-verificacion"
                  aria-describedby={`${idPaso} ${idEnvio}`}
                  value={codigo}
                  onChange={(e) => {
                    setCodigo(soloDigitos(e.target.value));
                    setErrorCodigo(null);
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    setCodigo(soloDigitos(e.clipboardData?.getData("text")));
                    setErrorCodigo(null);
                  }}
                />
              </Campo>
              {/* Con Enter el foco ya estaba en el campo: sin esta región el
                  error no se anunciaba (QA-TECH, US-002, 11/11/2026). */}
              <span className="visually-hidden" aria-live="assertive">
                {errorCodigo ?? ""}
              </span>
              <div className="rol-pagos__reenvio">
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0"
                  onClick={pedirCodigo}
                  disabled={espera.restantes > 0 || ocupado}
                >
                  {pidiendo ? "Enviando código…" : "Enviar otro código"}
                </button>
                {/* La espera, fuera del botón desactivado y sin aria-live
                    (cambia cada segundo); al terminar desaparece y la región
                    de abajo anuncia que ya puede pedir otro. */}
                {espera.restantes > 0 && (
                  <span className="mz-small mz-faint">
                    Podrá pedir otro código en{" "}
                    {tiempoDeEspera(espera.restantes)}.
                  </span>
                )}
                <span className="visually-hidden" aria-live="polite">
                  {espera.aviso}
                </span>
              </div>
            </div>
          </>
        )}
        <div className="mz-actions justify-content-end">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={onCerrar}
          >
            Cancelar
          </button>
          {paso === "terminos" ? (
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!acepto || ocupado || espera.restantes > 0}
            >
              {pidiendo ? "Enviando código…" : "Enviarme el código"}
            </button>
          ) : (
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={ocupado}
            >
              {consultando ? "Consultando…" : "Confirmar"}
            </button>
          )}
        </div>
      </form>
    </Ventana>
  );
}

/** Enviar el último rol consultado al correo personal (se regenera). */
function EnviarCorreo({ estado, ultima, onCorreoGuardado }) {
  const [correo, setCorreo] = useState("");
  const [guardar, setGuardar] = useState(false);
  const [aceptoGuardar, setAceptoGuardar] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const usaGuardado = !correo.trim() && Boolean(estado.correo_guardado);

  async function enviar(evento) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    setAviso(null);
    try {
      const respuesta = await nominaService.enviar({
        consulta: ultima.consulta,
        correo: correo.trim(),
        guardar: guardar && Boolean(correo.trim()),
        acepto_guardar: aceptoGuardar,
      });
      setAviso(`Listo: se envió a ${respuesta.enviado_a}.`);
      if (guardar && aceptoGuardar && correo.trim()) onCorreoGuardado();
      setCorreo("");
      setGuardar(false);
      setAceptoGuardar(false);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo enviar el correo."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="mz-card" aria-labelledby="rol-enviar-titulo">
      <form className="mz-card-body mz-stack" onSubmit={enviar}>
        <div>
          <h3 id="rol-enviar-titulo" className="h6 mb-1">
            <Icon name="envelope" /> Enviar a mi correo personal
          </h3>
          <p className="mz-faint mz-small mb-0">
            Se envía el rol de {MESES[ultima.mes - 1].toLowerCase()} de{" "}
            {ultima.anio} que acaba de consultar (se vuelve a generar; no queda
            guardado). Puede hacerlo durante 15 minutos.
          </p>
        </div>
        {aviso && (
          <div className="mz-alert mz-alert--ok" role="status">
            <Icon name="check2-circle" />
            {aviso}
          </div>
        )}
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        <div>
          <label className="form-label mz-small" htmlFor="rol-correo">
            Correo personal
          </label>
          <input
            id="rol-correo"
            type="email"
            className="form-control form-control-sm"
            placeholder={
              estado.correo_guardado
                ? `Vacío: se usa el guardado (${estado.correo_guardado})`
                : "nombre@correo.com"
            }
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
          />
          <small className="mz-faint">
            No se guarda, salvo que marque la opción de abajo.
          </small>
        </div>
        {correo.trim() && (
          <label className="form-check">
            <input
              type="checkbox"
              className="form-check-input"
              checked={guardar}
              onChange={(e) => {
                setGuardar(e.target.checked);
                if (!e.target.checked) setAceptoGuardar(false);
              }}
            />{" "}
            <span className="form-check-label">
              Guardar este correo para próximos envíos
            </span>
          </label>
        )}
        {guardar && correo.trim() && (
          <div className="rol-pagos__consentimiento">
            <p className="mz-small mb-2">{estado.consentimiento_correo}</p>
            <label className="form-check mb-0">
              <input
                type="checkbox"
                className="form-check-input"
                checked={aceptoGuardar}
                onChange={(e) => setAceptoGuardar(e.target.checked)}
              />{" "}
              <span className="form-check-label">
                Acepto que se almacene mi correo personal.
              </span>
            </label>
          </div>
        )}
        <div className="mz-actions justify-content-end">
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={
              enviando ||
              (!correo.trim() && !usaGuardado) ||
              (guardar && !aceptoGuardar)
            }
          >
            {enviando ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </form>
    </section>
  );
}

const CAMPOS_AVISO = [
  "aviso_activo",
  "aviso_titulo",
  "aviso_mensaje",
  "aviso_titulo_vencido",
  "aviso_mensaje_vencido",
  "aviso_recordatorio",
  "aviso_recordatorio_vencido",
  "aviso_dias_habiles",
];

const AYUDA_MARCADORES =
  "Puede usar {mes} (el mes del rol, p. ej. «septiembre»), {anio} (su año), {dias} (los días hábiles permitidos), {primer_dia} (el primer día hábil del mes) y {fecha_limite} (el último día para aceptarlo); las fechas se calculan con los feriados del calendario.";

/** «miércoles 4 de noviembre», como lo escribe el servidor. */
function fechaEnTexto(fecha) {
  if (!fecha) return "";
  return new Date(`${fecha}T00:00:00`)
    .toLocaleDateString("es-EC", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
    .replace(",", "");
}

/** Como el servidor reemplaza los marcadores, para la vista previa. */
function rellenarAviso(texto, { anio, mes, dias, primerDia, fechaLimite }) {
  return (texto ?? "")
    .replaceAll("{mes}", MESES[mes - 1].toLowerCase())
    .replaceAll("{anio}", String(anio))
    .replaceAll("{dias}", String(dias))
    .replaceAll("{primer_dia}", fechaEnTexto(primerDia) || "[primer día hábil]")
    .replaceAll(
      "{fecha_limite}",
      fechaEnTexto(fechaLimite) || "[fecha límite]",
    );
}

/**
 * El aviso del primer día hábil (aviso del rol de pagos, 29/10/2026): sale al
 * iniciar sesión hasta que la persona acepta su rol del mes anterior; pasados
 * los días hábiles permitidos, con el mensaje de plazo vencido.
 */
function SeccionAviso({ aviso, habiles = [], errores, onCambio }) {
  const hoy = new Date();
  const dias = aviso.aviso_dias_habiles || 3;
  // Las fechas del plazo de este mes, con los días hábiles que calcula el
  // servidor (feriados incluidos).
  const ejemplo = {
    anio: hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear(),
    mes: hoy.getMonth() === 0 ? 12 : hoy.getMonth(),
    dias,
    primerDia: habiles[0],
    fechaLimite: habiles[Math.min(dias, habiles.length) - 1],
  };
  const texto = (campo) => (e) => onCambio(campo, e.target.value);
  return (
    <fieldset className="mz-stack">
      <legend className="h6 mb-0">Aviso del primer día hábil</legend>
      <p className="mz-small mz-faint mb-0">
        Desde el primer día hábil de cada mes, al iniciar sesión, invita a quien
        está habilitado a revisar y aceptar su rol del mes anterior. Sale en
        cada inicio de sesión hasta que lo acepte (o deje una observación);
        pasados los días hábiles permitidos, muestra el mensaje de plazo
        vencido.
      </p>
      <label className="form-check form-switch">
        <input
          type="checkbox"
          role="switch"
          className="form-check-input"
          checked={Boolean(aviso.aviso_activo)}
          onChange={(e) => onCambio("aviso_activo", e.target.checked)}
        />{" "}
        <span className="form-check-label">
          {aviso.aviso_activo
            ? "Aviso encendido: se muestra al iniciar sesión"
            : "Aviso apagado: no se muestra"}
        </span>
      </label>
      <Campo
        id="rol-cfg-aviso-dias"
        etiqueta="Días hábiles permitidos para aceptar el rol"
        obligatorio
        ayuda="De 1 a 20. Desde el día hábil siguiente se muestra el mensaje de plazo vencido."
        error={errores.aviso_dias_habiles}
      >
        <input
          type="number"
          min={1}
          max={20}
          className="form-control form-control-sm"
          value={aviso.aviso_dias_habiles}
          onChange={(e) =>
            onCambio(
              "aviso_dias_habiles",
              e.target.value === "" ? "" : Number(e.target.value),
            )
          }
        />
      </Campo>
      <Campo
        id="rol-cfg-aviso-titulo"
        etiqueta="Título del aviso"
        obligatorio={Boolean(aviso.aviso_activo)}
        error={errores.aviso_titulo}
      >
        <input
          type="text"
          maxLength={150}
          className="form-control form-control-sm"
          value={aviso.aviso_titulo}
          onChange={texto("aviso_titulo")}
        />
      </Campo>
      <Campo
        id="rol-cfg-aviso-mensaje"
        etiqueta="Mensaje del aviso"
        ayuda={AYUDA_MARCADORES}
        error={errores.aviso_mensaje}
      >
        <textarea
          rows={4}
          maxLength={2000}
          className="form-control form-control-sm"
          value={aviso.aviso_mensaje}
          onChange={texto("aviso_mensaje")}
        />
      </Campo>
      <Campo
        id="rol-cfg-aviso-titulo-vencido"
        etiqueta="Título con el plazo vencido"
        obligatorio={Boolean(aviso.aviso_activo)}
        error={errores.aviso_titulo_vencido}
      >
        <input
          type="text"
          maxLength={150}
          className="form-control form-control-sm"
          value={aviso.aviso_titulo_vencido}
          onChange={texto("aviso_titulo_vencido")}
        />
      </Campo>
      <Campo
        id="rol-cfg-aviso-mensaje-vencido"
        etiqueta="Mensaje con el plazo vencido"
        ayuda={`${AYUDA_MARCADORES} Conviene advertir que exceder el plazo puede ser sancionado.`}
        error={errores.aviso_mensaje_vencido}
      >
        <textarea
          rows={4}
          maxLength={2000}
          className="form-control form-control-sm"
          value={aviso.aviso_mensaje_vencido}
          onChange={texto("aviso_mensaje_vencido")}
        />
      </Campo>
      <Campo
        id="rol-cfg-aviso-recordatorio"
        etiqueta="Recordatorio tras «Recordarme después»"
        ayuda={`Queda arriba de cada pantalla si la persona pospone el aviso, hasta que acepte su rol. ${AYUDA_MARCADORES}`}
        error={errores.aviso_recordatorio}
      >
        <textarea
          rows={3}
          maxLength={1000}
          className="form-control form-control-sm"
          value={aviso.aviso_recordatorio}
          onChange={texto("aviso_recordatorio")}
        />
      </Campo>
      <Campo
        id="rol-cfg-aviso-recordatorio-vencido"
        etiqueta="Recordatorio con el plazo vencido"
        ayuda="El mismo recordatorio, cuando ya pasó la fecha límite."
        error={errores.aviso_recordatorio_vencido}
      >
        <textarea
          rows={3}
          maxLength={1000}
          className="form-control form-control-sm"
          value={aviso.aviso_recordatorio_vencido}
          onChange={texto("aviso_recordatorio_vencido")}
        />
      </Campo>
      <details>
        <summary>Vista previa del mensaje</summary>
        {habiles.length === 0 && (
          <p className="mz-small mz-faint mt-2 mb-0">
            No se pudieron calcular las fechas del plazo; en la vista previa
            aparecen entre corchetes.
          </p>
        )}
        <div className="mz-stack mt-2">
          {[
            ["Dentro del plazo", "aviso_titulo", "aviso_mensaje"],
            [
              "Con el plazo vencido",
              "aviso_titulo_vencido",
              "aviso_mensaje_vencido",
            ],
          ].map(([cuando, titulo, mensaje]) => {
            const vencido = titulo === "aviso_titulo_vencido";
            // Con el aspecto del aviso real (etiqueta y filo de advertencia),
            // para ver cómo se distinguen los dos estados.
            return (
              <div key={cuando}>
                <p className="mz-small mz-faint mb-1">{cuando}</p>
                <div
                  className={`aviso-inicio aviso-inicio--vista-previa${
                    vencido ? " aviso-inicio--advertencia" : ""
                  }`}
                >
                  <div className="aviso-inicio__cuerpo">
                    <span className="aviso-inicio__etiqueta">
                      <Icon
                        name={
                          vencido
                            ? "exclamation-triangle-fill"
                            : "file-earmark-text"
                        }
                      />{" "}
                      {vencido ? "Plazo vencido" : "Rol de pagos"}
                    </span>
                    <p className="aviso-inicio__titulo-previa">
                      {rellenarAviso(aviso[titulo], ejemplo)}
                    </p>
                    <div className="aviso-inicio__contenido">
                      {rellenarAviso(aviso[mensaje], ejemplo)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </details>
    </fieldset>
  );
}

/** Los textos de la consulta (con `roles_pago.configurar`). */
function Configurar({ estado, onGuardado, onCerrar }) {
  const [terminos, setTerminos] = useState(estado.terminos);
  const [consentimiento, setConsentimiento] = useState(
    estado.consentimiento_correo,
  );
  // Los textos del aviso del primer día hábil llegan aparte (aviso del rol
  // de pagos, 29/10/2026); si no cargan, se guarda lo demás y el aviso se
  // queda como estaba.
  const [aviso, setAviso] = useState(null);
  const [habiles, setHabiles] = useState([]);
  const [errorAviso, setErrorAviso] = useState(null);
  const [error, setError] = useState(null);
  // Errores del servidor junto a su campo (auditoría UX/UI, fase 2,
  // 28/10/2026).
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const formulario = useRef(null);

  function cargarAviso() {
    setErrorAviso(null);
    return nominaService
      .configuracion()
      .then((datos) => {
        setAviso(Object.fromEntries(CAMPOS_AVISO.map((c) => [c, datos[c]])));
        setHabiles(datos.habiles_del_mes ?? []);
      })
      .catch((err) =>
        setErrorAviso(
          mensajeDeError(err, "No se pudieron cargar los textos del aviso."),
        ),
      );
  }

  useEffect(() => {
    cargarAviso();
  }, []);

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    setErrores({});
    try {
      await nominaService.configurar({
        terminos,
        consentimiento_correo: consentimiento,
        ...(aviso ?? {}),
      });
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
      setErrores(erroresPorCampo(err));
      setGuardando(false);
      enfocarPrimerError(formulario.current);
    }
  }

  return (
    <Ventana titulo="Textos de la consulta" onCerrar={onCerrar}>
      <form ref={formulario} className="mz-stack" onSubmit={guardar}>
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        <LeyendaObligatorios />
        <Campo
          id="rol-cfg-terminos"
          etiqueta="Términos que se aceptan en cada consulta"
          obligatorio
          ayuda={`Si los cambia, quien consulte después los aceptará de nuevo. Versión actual: ${estado.version}.`}
          error={errores.terminos}
        >
          <textarea
            rows={6}
            maxLength={4000}
            className="form-control form-control-sm"
            value={terminos}
            onChange={(e) => setTerminos(e.target.value)}
          />
        </Campo>
        <Campo
          id="rol-cfg-correo"
          etiqueta="Consentimiento para guardar el correo personal"
          obligatorio
          error={errores.consentimiento_correo}
        >
          <textarea
            rows={4}
            maxLength={2000}
            className="form-control form-control-sm"
            value={consentimiento}
            onChange={(e) => setConsentimiento(e.target.value)}
          />
        </Campo>
        {aviso ? (
          <SeccionAviso
            aviso={aviso}
            habiles={habiles}
            errores={errores}
            onCambio={(campo, valor) =>
              setAviso((a) => ({ ...a, [campo]: valor }))
            }
          />
        ) : (
          <EstadoDeCarga
            cargando={!errorAviso}
            error={errorAviso}
            onReintentar={cargarAviso}
          />
        )}
        <div className="mz-actions justify-content-end">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={onCerrar}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={guardando}
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Ventana>
  );
}

/** Las observaciones de la persona a sus roles de pagos, en todos sus
 * estados (22/10/2026): solo las suyas, con la conversación con Talento
 * Humano. */
function MisObservaciones() {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);
  function cargar() {
    setError(null);
    nominaService
      .misObservaciones()
      .then(setLista)
      // Antes un fallo se veía como «no tiene observaciones» (auditoría
      // UX/UI, fase 2, 28/10/2026).
      .catch((err) =>
        setError(
          mensajeDeError(err, "No se pudieron cargar sus observaciones."),
        ),
      );
  }
  useEffect(() => {
    cargar();
  }, []);
  if (error) return <EstadoDeCarga error={error} onReintentar={cargar} />;
  if (!lista || lista.length === 0) return null;
  return (
    <section className="mz-card" aria-label="Mis observaciones">
      <div className="mz-card-body mz-stack">
        <h3 className="h6 mb-0">
          <Icon name="chat-left-dots" /> Mis observaciones
        </h3>
        {lista.map((o) => (
          <details key={o.id} className="rol-pagos__observacion">
            <summary>
              <strong className="text-capitalize">
                {MESES[o.mes - 1]} {o.anio}
              </strong>{" "}
              · <span className="mz-pill">{o.estado_display}</span>
              {o.ultima && <span className="mz-faint"> · {o.ultima}</span>}
            </summary>
            <ol className="sugerencia-comentarios mt-2">
              {(o.mensajes ?? []).map((m) => (
                <li key={m.id}>
                  <strong>{m.tipo_display}</strong>{" "}
                  <small className="mz-faint">
                    · {m.autor} · {formatearFecha(m.fecha, true)}
                  </small>
                  {m.texto && <p className="mb-0">{m.texto}</p>}
                  <AdjuntosObservacion adjuntos={m.adjuntos} />
                </li>
              ))}
            </ol>
          </details>
        ))}
      </div>
    </section>
  );
}

/** Sus roles de pagos abiertos (26/10/2026): por período, cuándo lo abrió
 * y aceptó los términos, y cuándo dio su conformidad, con fecha, hora e IP. */
function MisRolesAbiertos({ roles }) {
  if (!roles?.length) return null;
  return (
    <section className="mz-card" aria-label="Mis roles abiertos">
      <div className="mz-card-body mz-stack">
        <h3 className="h6 mb-0">
          <Icon name="envelope-open" /> Mis roles abiertos
        </h3>
        <ul className="rol-constancia__lista">
          {roles.map((r) => (
            <li key={`${r.anio}-${r.mes}`}>
              <strong>
                {MESES[r.mes - 1]} {r.anio}
              </strong>
              <ConstanciaRol rol={r} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Un botón que despliega una lista de acciones (patrón de divulgación:
 * `aria-expanded` y la lista a continuación, sin `role="menu"`, para que Tab
 * recorra las opciones). Escape, un clic fuera o salir con Tab la cierran, y
 * Escape devuelve el foco al botón. Al elegir una, el foco vuelve al botón
 * antes de abrir su ventana: así, al cerrarla, regresa a un lugar que existe
 * (revisión final UX/UI, 28/10/2026).
 */
function MenuDeGestion({ etiqueta, acciones }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef(null);
  const boton = useRef(null);
  const idLista = useId();

  // Mientras está abierta: un clic o el foco fuera la cierran, y Escape
  // también, devolviendo el foco al botón.
  useEffect(() => {
    if (!abierto) return undefined;
    function fuera(evento) {
      if (!caja.current?.contains(evento.target)) setAbierto(false);
    }
    function escape(evento) {
      if (evento.key !== "Escape") return;
      evento.stopPropagation();
      setAbierto(false);
      boton.current?.focus();
    }
    document.addEventListener("mousedown", fuera);
    document.addEventListener("focusin", fuera);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("focusin", fuera);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);

  return (
    <div className="rol-gestion" ref={caja}>
      <button
        ref={boton}
        type="button"
        className="btn btn-outline-secondary btn-sm"
        aria-expanded={abierto}
        aria-controls={abierto ? idLista : undefined}
        onClick={() => setAbierto((actual) => !actual)}
      >
        {etiqueta} <Icon name={abierto ? "chevron-up" : "chevron-down"} />
      </button>
      {abierto && (
        <ul id={idLista} className="rol-gestion__lista" aria-label={etiqueta}>
          {acciones.map((accion) => (
            <li key={accion.id}>
              <button
                type="button"
                className="rol-gestion__opcion"
                onClick={() => {
                  setAbierto(false);
                  boton.current?.focus();
                  accion.abrir();
                }}
              >
                <Icon name={accion.icono} /> {accion.texto}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Institucional → Consultar rol de pagos: se elige año y mes (el código de
 * empleado sale de la sesión), se aceptan los términos y se confirma con el
 * código de 6 dígitos que llega al correo de la cuenta (US-002, 11/11/2026).
 * El PDF se ve y se descarga; se puede enviar al correo personal.
 */
export function RolPagosPage() {
  const hoy = new Date();
  const location = useLocation();
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  // Por defecto, el mes anterior (en enero, diciembre del año pasado).
  const [periodo, setPeriodo] = useState(() => {
    // Desde el aviso de «rol corregido» o el del rol de pagos al iniciar
    // sesión llega con el año y el mes.
    const pedido = periodoPedido(location.search);
    if (pedido) return { ...pedido, codigo: "" };
    return {
      anio: hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear(),
      mes: hoy.getMonth() === 0 ? 12 : hoy.getMonth(),
      codigo: "",
    };
  });
  const [confirmando, setConfirmando] = useState(false);
  const [visto, setVisto] = useState(null);
  const [ultima, setUltima] = useState(null);
  const [configurando, setConfigurando] = useState(false);
  const [historial, setHistorial] = useState(false);
  const [habilitados, setHabilitados] = useState(false);
  const [masiva, setMasiva] = useState(false);
  const [seguimiento, setSeguimiento] = useState(false);
  const [auditado, setAuditado] = useState(false);
  // El último mes consultado sin rol: se dice en la página, con qué revisar.
  const [sinRol, setSinRol] = useState(null);

  function cargar() {
    setError(null);
    return nominaService
      .estado()
      .then((datos) => {
        setEstado(datos);
        // El código se autocompleta con el de la sesión (si aún no hay otro).
        setPeriodo((p) => (p.codigo ? p : { ...p, codigo: datos.codigo }));
      })
      .catch((err) => setError(mensajeDeError(err, "No se pudo cargar.")));
  }

  useEffect(() => {
    cargar();
  }, []);

  // Si la página ya estaba abierta y el aviso del rol de pagos lleva a ella
  // con otro `?anio=&mes=`, el período también queda elegido (aviso del rol
  // de pagos, 29/10/2026). Va por `location.key`: cada navegación, aunque
  // repita la dirección, vuelve a elegirlo.
  useEffect(() => {
    const pedido = periodoPedido(location.search);
    if (pedido) setPeriodo((p) => ({ ...p, ...pedido }));
  }, [location.key, location.search]);

  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);
  // La constancia del período elegido, si ya abrió su propio rol de ese mes.
  const elegido =
    (!periodo.codigo.trim() || periodo.codigo.trim() === estado?.codigo) &&
    (estado?.mis_roles ?? []).find(
      (r) => r.anio === periodo.anio && r.mes === periodo.mes,
    );
  const mesesDelAnio =
    Number(periodo.anio) === hoy.getFullYear() ? hoy.getMonth() + 1 : 12;

  // Las acciones de gestión, de la más usada a la menos.
  const [principal, ...resto] = [
    estado?.puede_seguimiento && {
      id: "seguimiento",
      icono: "envelope-exclamation",
      texto: "Roles sin abrir",
      abrir: () => setSeguimiento(true),
    },
    estado?.puede_descarga_masiva && {
      id: "masiva",
      icono: "file-earmark-zip",
      texto: "Descarga masiva",
      abrir: () => setMasiva(true),
    },
    estado?.puede_habilitar && {
      id: "habilitados",
      icono: "person-check",
      texto: "Usuarios habilitados",
      abrir: () => setHabilitados(true),
    },
    estado?.puede_ver_historial && {
      id: "auditado",
      icono: "file-earmark-check",
      texto: "Descargar rol auditado",
      abrir: () => setAuditado(true),
    },
    estado?.puede_ver_historial && {
      id: "historial",
      icono: "clock-history",
      texto: "Historial por empleado",
      abrir: () => setHistorial(true),
    },
    estado?.puede_configurar && {
      id: "textos",
      icono: "gear",
      texto: "Textos de la consulta",
      abrir: () => setConfigurando(true),
    },
  ].filter(Boolean);

  async function olvidar() {
    if (
      !(await confirmar({
        titulo: "¿Eliminar su correo personal guardado?",
        mensaje:
          "Tendrá que escribirlo de nuevo para recibir el rol por correo.",
        accion: "Eliminar",
      }))
    )
      return;
    try {
      await nominaService.olvidarCorreo();
      setAviso("Su correo personal guardado se eliminó.");
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo eliminar."));
    }
  }

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Consultar rol de pagos</h2>
          <p className="mz-desc">
            Elija el año y el mes. Para verlo, acepte los términos y escriba el
            código de 6 dígitos que le enviaremos al correo de su cuenta. El
            documento no se guarda en el sistema; cuando acepta su rol, ese rol
            queda guardado como constancia y es el que verá desde entonces.
          </p>
        </div>
        {/* Revisión final UX/UI (28/10/2026): eran hasta seis botones
            iguales. Queda a la vista la primera acción de gestión a la que
            tiene acceso (en Talento Humano, «Roles sin abrir») y el resto va
            en el menú «Gestión de roles». */}
        {principal && (
          <div className="mz-actions">
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={principal.abrir}
            >
              <Icon name={principal.icono} /> {principal.texto}
            </button>
            {resto.length > 0 && (
              <MenuDeGestion etiqueta="Gestión de roles" acciones={resto} />
            )}
          </div>
        )}
      </div>

      {/* Mientras llega el estado, «Cargando…»; si falla, con «Reintentar»
          (auditoría UX/UI, fase 2, 28/10/2026). */}
      {estado === null && (
        <EstadoDeCarga cargando error={error} onReintentar={cargar} />
      )}
      {estado && error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check-circle" />
          {aviso}
        </div>
      )}
      {estado && !estado.habilitado && (
        <div className="mz-alert mz-alert--warn" role="status">
          <Icon name="person-lock" />
          Su cuenta no está habilitada para consultar el rol de pagos. Se
          habilita a quienes aceptaron recibirlo en forma virtual: pídaselo a
          Talento Humano.
        </div>
      )}
      {estado?.habilitado &&
        !estado.codigo &&
        !estado.puede_consultar_otros && (
          <div className="mz-alert mz-alert--warn" role="status">
            <Icon name="person-vcard" />
            Su cuenta todavía no tiene código de empleado, así que no puede
            consultar su rol de pagos. Pídale a Talento Humano que se lo asigne.
          </div>
        )}
      {estado && !estado.disponible && (
        <div className="mz-alert mz-alert--warn" role="status">
          <Icon name="hourglass-split" />
          La consulta del rol de pagos todavía no está disponible.
        </div>
      )}

      {estado?.habilitado && (
        <section className="mz-card" aria-label="Período a consultar">
          <form
            className="mz-card-body rol-pagos__periodo"
            onSubmit={(e) => {
              e.preventDefault();
              setAviso(null);
              setSinRol(null);
              setConfirmando(true);
            }}
          >
            <div>
              <label className="form-label mz-small" htmlFor="rol-anio">
                Año
              </label>
              <select
                id="rol-anio"
                className="form-select form-select-sm"
                value={periodo.anio}
                onChange={(e) => {
                  const anio = Number(e.target.value);
                  setPeriodo((p) => ({
                    ...p,
                    anio,
                    mes:
                      anio === hoy.getFullYear()
                        ? Math.min(p.mes, hoy.getMonth() + 1)
                        : p.mes,
                  }));
                }}
              >
                {anios.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label mz-small" htmlFor="rol-mes">
                Mes
              </label>
              <select
                id="rol-mes"
                className="form-select form-select-sm"
                value={periodo.mes}
                onChange={(e) =>
                  setPeriodo((p) => ({ ...p, mes: Number(e.target.value) }))
                }
              >
                {MESES.slice(0, mesesDelAnio).map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label mz-small" htmlFor="rol-codigo">
                Código de empleado
              </label>
              {estado.puede_consultar_otros ? (
                <>
                  <input
                    id="rol-codigo"
                    className="form-control form-control-sm"
                    placeholder={
                      estado.codigo ? `El suyo: ${estado.codigo}` : "Código"
                    }
                    maxLength={40}
                    inputMode="numeric"
                    aria-describedby="rol-codigo-ayuda"
                    value={periodo.codigo}
                    onChange={(e) =>
                      setPeriodo((p) => ({ ...p, codigo: e.target.value }))
                    }
                  />
                  <small id="rol-codigo-ayuda" className="mz-faint">
                    {periodo.codigo.trim() &&
                    periodo.codigo.trim() !== estado.codigo ? (
                      <>
                        Consultando a otra persona.{" "}
                        {estado.codigo && (
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 align-baseline"
                            onClick={() =>
                              setPeriodo((p) => ({
                                ...p,
                                codigo: estado.codigo,
                              }))
                            }
                          >
                            Volver a mi código
                          </button>
                        )}
                      </>
                    ) : (
                      "El suyo; puede escribir el de otra persona."
                    )}
                  </small>
                </>
              ) : (
                <>
                  {/* Sin permiso no se cambia ni se borra: es el de su cuenta
                      (el servidor tampoco acepta otro). */}
                  <input
                    id="rol-codigo"
                    className="form-control form-control-sm rol-pagos__codigo-fijo"
                    value={estado.codigo || "Sin código"}
                    readOnly
                    aria-readonly="true"
                    aria-describedby="rol-codigo-ayuda"
                  />
                  <small id="rol-codigo-ayuda" className="mz-faint">
                    <Icon name="lock" /> Solo su código; prohibido usar el de
                    otra persona.
                  </small>
                </>
              )}
            </div>
            {/* A la altura de los campos, no del fondo de la fila: debajo del
                código puede haber una línea de ayuda. */}
            <div className="rol-pagos__accion">
              <span className="form-label mz-small" aria-hidden="true">
                &nbsp;
              </span>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={
                  !estado.disponible ||
                  (!estado.codigo &&
                    !(estado.puede_consultar_otros && periodo.codigo.trim()))
                }
              >
                <Icon name="search" /> Consultar
              </button>
            </div>
          </form>
          {elegido && (
            <div className="mz-card-body pt-0">
              <ConstanciaRol rol={elegido} />
            </div>
          )}
        </section>
      )}

      {estado?.por_confirmar?.length > 0 && (
        <section
          className="mz-card rol-pagos__por-confirmar"
          aria-label="Correcciones por confirmar"
        >
          <div className="mz-card-body mz-stack">
            <h3 className="h6 mb-0">
              <Icon name="arrow-repeat" /> Talento Humano corrigió su rol de
              pagos
            </h3>
            {estado.por_confirmar.map((c) => (
              <div key={c.id} className="rol-pagos__correccion">
                <span>
                  <strong className="text-capitalize">
                    {MESES[c.mes - 1]} {c.anio}
                  </strong>
                  {c.nota && <span className="mz-faint"> · {c.nota}</span>}
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setPeriodo((p) => ({
                      ...p,
                      anio: c.anio,
                      mes: c.mes,
                      codigo: estado.codigo,
                    }));
                    setSinRol(null);
                    setConfirmando(true);
                  }}
                >
                  Revisar y confirmar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {sinRol && (
        <section className="mz-card rol-pagos__sin-rol" role="status">
          <div className="mz-card-body">
            <Icon name="calendar-x" className="rol-pagos__sin-rol-icono" />
            <div>
              <h3 className="h6 mb-1">
                Sin rol de pagos para {MESES[sinRol.mes - 1].toLowerCase()} de{" "}
                {sinRol.anio}
              </h3>
              <p className="mb-1">{sinRol.mensaje}</p>
              <ul className="mz-faint mz-small mb-0">
                <li>Puede que ese mes todavía no esté cerrado en nómina.</li>
                <li>O que en ese período no estuviera en nómina.</li>
                <li>Si cree que es un error, consulte con Talento Humano.</li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {ultima && (
        <div className="d-flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={() => setVisto(ultima)}
          >
            <Icon name="file-earmark-pdf" /> Ver de nuevo el rol de{" "}
            {MESES[ultima.mes - 1].toLowerCase()} {ultima.anio}
          </button>
        </div>
      )}
      {ultima && (
        <EnviarCorreo
          key={ultima.consulta}
          estado={estado}
          ultima={ultima}
          onCorreoGuardado={cargar}
        />
      )}

      {estado?.correo_guardado && (
        <p className="mz-faint mz-small mb-0">
          Tiene guardado el correo personal {estado.correo_guardado}.{" "}
          <button
            type="button"
            className="btn btn-link btn-sm p-0 align-baseline"
            onClick={olvidar}
          >
            Eliminarlo
          </button>
        </p>
      )}

      {confirmando && estado && (
        <Confirmar
          estado={estado}
          periodo={periodo}
          onCerrar={() => setConfirmando(false)}
          onCambiarPeriodo={() => {
            // El código es de ese período: se cierra la ventana, se elige
            // otro y se pide un código nuevo (US-002, 11/11/2026).
            setConfirmando(false);
            requestAnimationFrame(() =>
              document.getElementById("rol-anio")?.focus(),
            );
          }}
          onPeriodoCambiado={() => {
            // El período cambió detrás de la ventana (QA-UX, US-002).
            setConfirmando(false);
            setAviso(
              "Cambió el período: pida un código nuevo para consultarlo.",
            );
          }}
          onSinRol={(mensaje) => {
            setConfirmando(false);
            setSinRol({ anio: periodo.anio, mes: periodo.mes, mensaje });
          }}
          onVisto={({ blob, consulta, aceptado }) => {
            const codigo = periodo.codigo.trim() || estado.codigo;
            const nuevo = {
              blob,
              consulta,
              anio: periodo.anio,
              mes: periodo.mes,
              // La conformidad es solo del rol propio. Si ya lo aceptó,
              // es definitivo: se muestra la aceptación y no se pregunta.
              propio: codigo === estado.codigo,
              conformidad: aceptado,
            };
            setConfirmando(false);
            setUltima(nuevo);
            setVisto(nuevo);
            // Queda la constancia de que lo abrió (fecha, hora e IP).
            cargar();
          }}
        />
      )}
      {visto && (
        <VisorRolPagos
          titulo={`Rol de pagos · ${MESES[visto.mes - 1]} ${visto.anio}`}
          blob={visto.blob}
          nombreArchivo={`rol-de-pagos-${visto.anio}-${String(visto.mes).padStart(2, "0")}.pdf`}
          consulta={visto.consulta}
          propio={visto.propio}
          conformidad={visto.conformidad}
          correccion={
            estado?.por_confirmar?.find(
              (c) => c.anio === visto.anio && c.mes === visto.mes,
            ) ?? null
          }
          onConformidad={(respuesta) => {
            setVisto((v) => v && { ...v, conformidad: respuesta });
            setUltima((u) => u && { ...u, conformidad: respuesta });
            // Confirmar (o volver a observar) cambia lo pendiente.
            cargar();
          }}
          onCerrar={() => setVisto(null)}
        />
      )}
      {estado?.habilitado && <MisRolesAbiertos roles={estado.mis_roles} />}
      {estado?.habilitado && <MisObservaciones />}
      {historial && <HistorialRolPagos onCerrar={() => setHistorial(false)} />}
      {habilitados && (
        <HabilitadosRolPagos onCerrar={() => setHabilitados(false)} />
      )}
      {masiva && <DescargaMasivaRolPagos onCerrar={() => setMasiva(false)} />}
      {seguimiento && (
        <SeguimientoRolPagos
          onCerrar={() => setSeguimiento(false)}
          puedeVerRol={Boolean(estado?.puede_ver_historial)}
        />
      )}
      {auditado && <AuditadoRolPagos onCerrar={() => setAuditado(false)} />}
      {configurando && estado && (
        <Configurar
          estado={estado}
          onCerrar={() => setConfigurando(false)}
          onGuardado={() => {
            setConfigurando(false);
            setAviso("Textos guardados.");
            cargar();
          }}
        />
      )}
    </div>
  );
}
