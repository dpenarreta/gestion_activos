/*
 * El detalle de una solicitud de derechos (`/admin/privacidad/solicitudes/:id`,
 * adonde lleva el aviso de la campana de quien atiende): el titular, lo que
 * pidió, el plazo, el historial con quién movió cada estado y, para quien
 * tiene `privacidad.atender`, el cambio de estado con la respuesta al titular
 * y la descarga de sus datos (solo en un ACCESO abierto:
 * `puede_descargar_datos`).
 *
 * Cada cambio manda el estado que se está viendo (`estado_esperado`): si otra
 * persona ya la movió, el servidor responde 409; se avisa y se recarga, sin
 * perder la respuesta escrita.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";

import {
  errorDePrivacidad,
  privacidadService,
} from "../../api/privacidadService";
import {
  Campo,
  LeyendaObligatorios,
} from "../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { avisarCambioDeInsignias } from "../../utils/insigniasDelMenu";
import { fijarTituloPropio } from "../../utils/tituloDocumento";
import { fechaHora } from "../GestionHumana/comunes";
import {
  AvisoVivo,
  BotonesDeDescarga,
  Historial,
  PildoraEstado,
  PildoraTipo,
  Plazo,
} from "./Piezas";
import {
  FINALES,
  RESPUESTA_MAX,
  RUTA_BANDEJA,
  TRANSICIONES,
  exigeRespuesta,
  textoDeEstado,
  textoDelPaso,
} from "./privacidadComunes";
import "./Privacidad.css";

/** Vuelve a la bandeja con sus filtros y le dice de qué solicitud se viene,
 * para devolverle el foco. */
function Volver({ id }) {
  const location = useLocation();
  const volverA = location.state?.volverA ?? "";
  return (
    <div>
      <Link
        to={`${RUTA_BANDEJA}${volverA}`}
        state={id ? { desde: id } : undefined}
        className="btn btn-link px-0 pv-enlace"
      >
        <Icon name="arrow-left" /> Volver a las solicitudes
      </Link>
    </div>
  );
}

export function DetalleSolicitudPrivacidad() {
  const { id } = useParams();
  const [solicitud, setSolicitud] = useState(null);
  // Si puede atender lo dice `me/`: mientras no responde (o si falla) la
  // columna de gestión queda reservada con su estado, sin saltos.
  const [acceso, setAcceso] = useState({
    cargando: true,
    error: null,
    puede: false,
  });
  const [vezAcceso, setVezAcceso] = useState(0);
  const [carga, setCarga] = useState({ error: null, noEncontrada: false });
  const [aviso, setAviso] = useState(null);
  const avisoRef = useRef(null);
  const resumenRef = useRef(null);
  const enfocar = useRef(null);

  const cargar = useCallback(
    () =>
      privacidadService
        .solicitud(id)
        .then((datos) => {
          setSolicitud(datos);
          setCarga({ error: null, noEncontrada: false });
        })
        .catch((err) => {
          const e = errorDePrivacidad(err, "No se pudo abrir la solicitud.");
          setSolicitud(null);
          setCarga({ error: e.mensaje, noEncontrada: e.estado === 404 });
        }),
    [id],
  );

  useEffect(() => {
    setSolicitud(null);
    setCarga({ error: null, noEncontrada: false });
    cargar();
  }, [cargar]);

  // Si puede atender lo dice el servidor; mientras no responda, la pantalla
  // es de solo lectura (y el servidor rechazaría igual el cambio). Si falla,
  // se dice y se puede reintentar: callarlo dejaba a quien atiende sin el
  // formulario y sin saber por qué.
  useEffect(() => {
    let vigente = true;
    setAcceso((a) => ({ ...a, cargando: true, error: null }));
    privacidadService
      .yo()
      .then((me) => {
        if (vigente)
          setAcceso({
            cargando: false,
            error: null,
            puede: Boolean(me?.puede_atender),
          });
      })
      .catch((err) => {
        if (vigente)
          setAcceso({
            cargando: false,
            puede: false,
            error: errorDePrivacidad(
              err,
              "No se pudo comprobar si puede atender esta solicitud.",
            ).mensaje,
          });
      });
    return () => {
      vigente = false;
    };
  }, [vezAcceso]);

  // El foco tras una acción, cuando la pantalla ya se pintó con lo nuevo:
  // al resumen tras un cambio (el formulario se rehízo), al aviso tras un
  // conflicto (para leer qué pasó).
  useEffect(() => {
    if (!enfocar.current || !solicitud) return;
    (enfocar.current === "aviso" ? avisoRef : resumenRef).current?.focus();
    enfocar.current = null;
  }, [solicitud, aviso]);

  const titulo = solicitud?.numero ? `Solicitud ${solicitud.numero}` : null;
  useEffect(() => {
    if (!titulo) return undefined;
    fijarTituloPropio(titulo);
    return () => fijarTituloPropio(null);
  }, [titulo]);

  if (!solicitud) {
    return (
      <div className="mz-stack pv-detalle-pagina">
        <Volver />
        <div className="mz-view-head">
          <div>
            <h2>Solicitud de derechos sobre datos</h2>
          </div>
        </div>
        {carga.noEncontrada ? (
          <div className="mz-alert mz-alert--warn" role="alert">
            <Icon name="search" />
            <span>No se encontró la solicitud o no tiene acceso a ella.</span>
          </div>
        ) : (
          <EstadoDeCarga
            cargando={!carga.error}
            error={carga.error}
            onReintentar={cargar}
          />
        )}
      </div>
    );
  }

  const s = solicitud;
  const conGestion = acceso.puede;
  const conColumna = conGestion || acceso.cargando || Boolean(acceso.error);

  return (
    <div className="mz-stack pv-detalle-pagina">
      <Volver id={s.id} />
      <div className="mz-view-head">
        <div>
          <h2>
            Solicitud <span className="mz-mono">{s.numero}</span>
          </h2>
          <p className="mz-desc">
            {s.titular?.nombre} · recibida el {fechaHora(s.creada_en)}
          </p>
        </div>
      </div>

      <AvisoVivo
        aviso={aviso}
        onCerrar={() => setAviso(null)}
        avisoRef={avisoRef}
      />

      <div
        className={`pv-detalle${conColumna ? "" : " pv-detalle--sin-gestion"}`}
      >
        <section
          className="mz-card pv-detalle__resumen"
          aria-labelledby="pv-resumen"
        >
          <div className="mz-card-head">
            <h3 id="pv-resumen" ref={resumenRef} tabIndex={-1}>
              Resumen
            </h3>
          </div>
          <div className="mz-card-body mz-stack">
            <dl className="pv-datos">
              <div>
                <dt>Titular</dt>
                <dd>
                  <span className="pv-titular">{s.titular?.nombre}</span>
                  <div className="mz-small mz-faint pv-titular">
                    {s.titular?.usuario}
                    {s.titular?.correo ? ` · ${s.titular.correo}` : ""}
                  </div>
                </dd>
              </div>
              <div>
                <dt>Tipo</dt>
                <dd>
                  <PildoraTipo tipo={s.tipo} texto={s.tipo_label} />
                </dd>
              </div>
              <div>
                <dt>Estado</dt>
                <dd>
                  <PildoraEstado estado={s.estado} texto={s.estado_label} />
                </dd>
              </div>
              <div>
                <dt>Plazo</dt>
                <dd>
                  <Plazo solicitud={s} />
                  <div className="mz-small mz-faint">
                    {s.plazo_dias} días desde que se recibió
                  </div>
                </dd>
              </div>
              {s.resuelta_por && (
                <div>
                  <dt>Respondida por</dt>
                  <dd>{s.resuelta_por.nombre}</dd>
                </div>
              )}
            </dl>
            {s.importada_de_nexo && (
              <p className="mz-small mz-faint mb-0">
                <Icon name="box-arrow-in-down" /> Importada de Nexo.
              </p>
            )}
            <div>
              <h4 className="pv-subtitulo">Lo que pidió</h4>
              {s.descripcion ? (
                <p className="pv-texto mb-0">{s.descripcion}</p>
              ) : (
                <p className="mz-small mz-faint mb-0">
                  No escribió una descripción.
                </p>
              )}
            </div>
            {s.respuesta && (
              <div className="pv-respuesta">
                <h4 className="pv-subtitulo">Última respuesta al titular</h4>
                <p className="pv-texto mb-0">{s.respuesta}</p>
              </div>
            )}
            {s.tipo === "ELIMINACION" && !FINALES.has(s.estado) && (
              <div className="mz-alert mz-alert--info mb-0">
                <Icon name="info-circle" />
                <span>
                  Nada se borra solo: haga la eliminación a mano y cuente en la
                  respuesta qué se borró y qué se conserva por obligación legal
                  (rol de pagos, auditoría).
                </span>
              </div>
            )}
          </div>
        </section>

        {!conGestion && conColumna && (
          <aside
            className="pv-detalle__lateral mz-stack"
            aria-label="Gestión de la solicitud"
          >
            <EstadoDeCarga
              cargando={acceso.cargando}
              error={acceso.error}
              onReintentar={() => setVezAcceso((v) => v + 1)}
            />
          </aside>
        )}
        {conGestion && (
          <aside className="pv-detalle__lateral mz-stack">
            {s.puede_descargar_datos && <DatosDelTitular solicitud={s} />}
            <CambiarEstado
              solicitud={s}
              onActualizada={(nueva) => {
                setSolicitud(nueva);
                // La insignia de vencidas del menú se pone al día enseguida.
                avisarCambioDeInsignias();
                setAviso({
                  texto: `La solicitud pasó a «${textoDeEstado(nueva.estado, nueva.estado_label)}». El titular recibirá un aviso.`,
                });
                enfocar.current = "resumen";
              }}
              onConflicto={(texto) => {
                setAviso({ tono: "warn", texto });
                enfocar.current = "aviso";
                cargar();
              }}
            />
          </aside>
        )}

        <section
          className="mz-card pv-detalle__historial"
          aria-labelledby="pv-historial"
        >
          <div className="mz-card-head">
            <h3 id="pv-historial">Historial</h3>
          </div>
          <div className="mz-card-body">
            <Historial historial={s.historial ?? []} conActor />
          </div>
        </section>
      </div>
    </div>
  );
}

function DatosDelTitular({ solicitud }) {
  return (
    <section className="mz-card" aria-labelledby="pv-datos-titular">
      <div className="mz-card-head">
        <h3 id="pv-datos-titular">Datos del titular</h3>
      </div>
      <div className="mz-card-body mz-stack">
        <p id="pv-datos-titular-ayuda" className="mz-small mb-0">
          Para responder esta solicitud de acceso. No incluye el chat ni el
          Escritorio de la persona, y los datos de salud salen según sus
          permisos. La descarga queda registrada.
        </p>
        <BotonesDeDescarga
          descargar={(formato) =>
            privacidadService.descargarDatosDelTitular(solicitud.id, formato)
          }
          sufijo="del titular"
          describe="pv-datos-titular-ayuda"
        />
      </div>
    </section>
  );
}

/** Mover la solicitud con la respuesta al titular. */
function CambiarEstado({ solicitud, onActualizada, onConflicto }) {
  const base = useId();
  const idRespuesta = `${base}-respuesta`;
  const idDestino = `${base}-destino`;
  const pasos = TRANSICIONES[solicitud.estado] ?? [];
  const [destino, setDestino] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);
  const primerPaso = useRef(null);
  const alertaRef = useRef(null);

  // Un fallo sin campo se lee al instante: el foco va a la alerta.
  useEffect(() => {
    if (errorGeneral) alertaRef.current?.focus();
  }, [errorGeneral]);

  // Si la solicitud cambió (por esta acción o por la recarga tras un 409),
  // el paso elegido ya no vale; la respuesta escrita se conserva.
  useEffect(() => {
    setDestino("");
    setErrores({});
  }, [solicitud.estado]);

  const obligatoria = destino
    ? exigeRespuesta(solicitud.estado, destino)
    : FINALES.has(solicitud.estado);

  async function guardar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const e = {};
    if (!destino) e.estado = "Elija a qué estado pasa.";
    else if (obligatoria && !respuesta.trim())
      e.respuesta = FINALES.has(solicitud.estado)
        ? "Escriba por qué se reabre la solicitud."
        : "Escriba la respuesta para el titular.";
    if (Object.keys(e).length) {
      setErrores(e);
      if (e.estado) primerPaso.current?.focus();
      else document.getElementById(idRespuesta)?.focus();
      return;
    }
    enCurso.current = true;
    setEnviando(true);
    setErrores({});
    setErrorGeneral(null);
    try {
      const nueva = await privacidadService.cambiarEstado(solicitud.id, {
        estado: destino,
        respuesta: respuesta.trim(),
        estadoEsperado: solicitud.estado,
      });
      setRespuesta("");
      onActualizada(nueva);
    } catch (err) {
      const fallo = errorDePrivacidad(err, "No se pudo cambiar el estado.");
      if (fallo.estado === 409) {
        onConflicto(
          `${fallo.mensaje} Se recargó la solicitud con su estado actual; su respuesta escrita se conservó.`,
        );
      } else if (fallo.campos.respuesta || fallo.campos.estado) {
        setErrores(fallo.campos);
        if (fallo.campos.respuesta)
          document.getElementById(idRespuesta)?.focus();
        else primerPaso.current?.focus();
      } else {
        setErrorGeneral(fallo.mensaje);
      }
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  return (
    <section className="mz-card" aria-labelledby="pv-cambiar">
      <div className="mz-card-head">
        <h3 id="pv-cambiar">Responder y cambiar el estado</h3>
      </div>
      <form
        className="mz-card-body pv-formulario"
        onSubmit={guardar}
        noValidate
        aria-busy={enviando}
      >
        <LeyendaObligatorios />
        {errorGeneral && (
          <div
            ref={alertaRef}
            tabIndex={-1}
            className="mz-alert mz-alert--bad pv-alerta"
            role="alert"
          >
            <Icon name="x-octagon" />
            <span>{errorGeneral}</span>
          </div>
        )}
        <fieldset
          className="pv-grupo"
          aria-describedby={errores.estado ? `${idDestino}-error` : undefined}
          aria-invalid={errores.estado ? true : undefined}
        >
          <legend className="pv-grupo__titulo">
            Pasar a
            <span className="mz-campo__obligatorio" aria-hidden="true">
              {" "}
              *
            </span>
            <span className="visually-hidden"> (obligatorio)</span>
          </legend>
          <div className="pv-pasos">
            {pasos.map((p, i) => (
              <label key={p} className="pv-paso">
                <input
                  ref={i === 0 ? primerPaso : undefined}
                  type="radio"
                  className="form-check-input"
                  name={idDestino}
                  value={p}
                  checked={destino === p}
                  aria-describedby={
                    errores.estado ? `${idDestino}-error` : undefined
                  }
                  onChange={() => {
                    setDestino(p);
                    setErrores((x) => ({ ...x, estado: undefined }));
                  }}
                />
                <span>
                  {textoDelPaso(solicitud.estado, p)}
                  {FINALES.has(solicitud.estado) && (
                    <span className="mz-faint"> (vuelve a «En proceso»)</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          {errores.estado && (
            <p id={`${idDestino}-error`} className="mz-field-error mb-0">
              {errores.estado}
            </p>
          )}
        </fieldset>
        <Campo
          id={idRespuesta}
          etiqueta={
            FINALES.has(solicitud.estado)
              ? "Motivo de la reapertura"
              : obligatoria
                ? "Respuesta al titular"
                : "Respuesta al titular (opcional)"
          }
          obligatorio={obligatoria}
          error={errores.respuesta}
          ayuda={`El titular la verá en su perfil y recibirá un aviso (el correo no lleva el texto). ${respuesta.length} de ${RESPUESTA_MAX} caracteres.`}
        >
          <textarea
            className="form-control"
            rows={5}
            value={respuesta}
            maxLength={RESPUESTA_MAX}
            // No se deshabilita mientras se envía: el foco no debe caer en
            // <body>; el envío doble lo frena `enCurso`.
            readOnly={enviando}
            onChange={(e) => {
              setRespuesta(e.target.value);
              setErrores((x) => ({ ...x, respuesta: undefined }));
            }}
          />
        </Campo>
        <div className="pv-acciones">
          <button
            type="submit"
            className="btn btn-primary pv-boton-envio"
            // No se deshabilita mientras se envía: el foco no debe caer en
            // <body>; el envío doble lo frena `enCurso`.
            aria-disabled={enviando ? "true" : undefined}
          >
            {enviando ? (
              <>
                <span
                  className="spinner-border spinner-border-sm"
                  aria-hidden="true"
                />{" "}
                Guardando…
              </>
            ) : (
              <>
                <Icon name="send" /> Guardar y avisar al titular
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
