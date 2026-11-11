/*
 * «Mis derechos» en el perfil (`/admin/perfil?seccion=mis-derechos`, adonde
 * llevan los avisos de la campana): qué derechos da la LOPDP en palabras
 * simples, la descarga inmediata de sus datos (con qué incluye y qué no), la
 * nueva solicitud y el seguimiento de las propias con su respuesta e
 * historial.
 *
 * Quien ya tiene solicitudes viene casi siempre a ver cómo van: «Mis
 * solicitudes» va primero. El aviso de un cambio trae `&solicitud=<id>`: la
 * pantalla lleva a esa solicitud, le da el foco y abre su historial.
 *
 * Es de toda persona con sesión, sin permiso: ejercer un derecho no puede
 * depender de un rol. El servidor solo devuelve lo propio.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  errorDePrivacidad,
  privacidadService,
} from "../../api/privacidadService";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { fechaHora } from "../GestionHumana/comunes";
import { NuevaSolicitud } from "./NuevaSolicitud";
import { useTextoVigente } from "../../hooks/useTextoVigente";
import {
  AvisoVivo,
  BotonesDeDescarga,
  ExplicacionDeTipo,
  Historial,
  PildoraEstado,
  Plazo,
} from "./Piezas";
import {
  CLAVES_TEXTO,
  DERECHOS_EXPLICACION_RESPALDO,
  PLAZO_POR_DEFECTO,
  TIPO,
  TIPOS,
} from "./privacidadComunes";
import { TextoDelAviso } from "./TextoDelAviso";
import "./Privacidad.css";

/** El id del título de cada solicitud: el foco va ahí tras crearla. */
const idDeMiSolicitud = (id) => `pv-mia-${id}`;
const ID_MIS_SOLICITUDES = "pv-mis-solicitudes";
const TEXTO_PEDIR = "Hacer una solicitud";

/** Desplaza hasta el elemento (jsdom no implementa `scrollIntoView`). */
function llevarA(elemento, bloque = "start") {
  if (elemento && typeof elemento.scrollIntoView === "function")
    elemento.scrollIntoView({ block: bloque });
}

export function MisDerechos() {
  const [me, setMe] = useState(null);
  const [solicitudes, setSolicitudes] = useState(null);
  const [error, setError] = useState(null);
  const [vez, setVez] = useState(0);
  // `false`: cerrada; si no, el tipo con que se abre ("" sin elegir).
  const [pidiendo, setPidiendo] = useState(false);
  const [aviso, setAviso] = useState(null);
  const enfocarTras = useRef(null);
  const [parametros] = useSearchParams();
  const pedida = parametros.get("solicitud");
  const [abrirHistorial, setAbrirHistorial] = useState(null);
  const atendida = useRef(null);

  useEffect(() => {
    let vigente = true;
    setError(null);
    setSolicitudes(null);
    Promise.all([privacidadService.yo(), privacidadService.misSolicitudes()])
      .then(([resumen, lista]) => {
        if (!vigente) return;
        setMe(resumen);
        setSolicitudes(Array.isArray(lista) ? lista : []);
      })
      .catch((err) => {
        if (vigente)
          setError(
            errorDePrivacidad(err, "No se pudieron cargar sus solicitudes.")
              .mensaje,
          );
      });
    return () => {
      vigente = false;
    };
  }, [vez]);

  // Tras crear una, el foco va a su título: se ve dónde quedó y se lee su
  // estado y su plazo.
  useEffect(() => {
    if (!solicitudes || !enfocarTras.current) return;
    document.getElementById(idDeMiSolicitud(enfocarTras.current))?.focus();
    enfocarTras.current = null;
  }, [solicitudes]);

  // Llegada desde un aviso: `&solicitud=<id>` lleva a esa solicitud (foco e
  // historial abierto); sin id, a «Mis solicitudes» si hay alguna (solo se
  // desplaza: el foco se queda donde estaba, p. ej. en la pestaña).
  useEffect(() => {
    if (!solicitudes) return;
    const clave = pedida ?? "";
    if (atendida.current === clave) return;
    atendida.current = clave;
    const id = Number(pedida);
    if (pedida && solicitudes.some((s) => s.id === id)) {
      setAbrirHistorial(id);
      const titulo = document.getElementById(idDeMiSolicitud(id));
      titulo?.focus();
      llevarA(titulo, "center");
    } else if (solicitudes.length > 0) {
      llevarA(document.getElementById(ID_MIS_SOLICITUDES));
    }
  }, [solicitudes, pedida]);

  const plazo = me?.plazo_dias ?? PLAZO_POR_DEFECTO;

  function alEnviar({ solicitud, creada }) {
    setPidiendo(false);
    setAviso(
      creada
        ? {
            texto: `Recibimos su solicitud ${solicitud.numero}. La empresa tiene hasta el ${fechaCorta(solicitud.fecha_limite)} para responderle.`,
          }
        : {
            tono: "info",
            texto: `Ya tenía una solicitud igual abierta (${solicitud.numero}): no se creó otra.`,
          },
    );
    setSolicitudes((lista) => [
      solicitud,
      ...(lista ?? []).filter((s) => s.id !== solicitud.id),
    ]);
    enfocarTras.current = solicitud.id;
  }

  const vacia = solicitudes !== null && solicitudes.length === 0;
  const tieneSolicitudes = solicitudes?.length > 0;

  const misSolicitudes = (
    <section
      key="mis-solicitudes"
      className="mz-card"
      aria-labelledby={ID_MIS_SOLICITUDES}
    >
      <div className="mz-card-head pv-cabecera">
        <h3 id={ID_MIS_SOLICITUDES}>Mis solicitudes</h3>
        {/* Sin solicitudes, el botón va en el vacío: uno solo. */}
        {!vacia && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setPidiendo("")}
            disabled={solicitudes === null && !error}
          >
            <Icon name="plus-lg" /> {TEXTO_PEDIR}
          </button>
        )}
      </div>
      <div className="mz-card-body mz-stack">
        <AvisoVivo aviso={aviso} onCerrar={() => setAviso(null)} />
        <EstadoDeCarga
          cargando={solicitudes === null && !error}
          error={error}
          onReintentar={() => setVez((v) => v + 1)}
          vacio={vacia}
          textoVacio="Todavía no ha hecho ninguna solicitud."
          accionVacio={
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setPidiendo("")}
            >
              <Icon name="plus-lg" /> {TEXTO_PEDIR}
            </button>
          }
        />
        {tieneSolicitudes && (
          <ul className="pv-lista" aria-label="Sus solicitudes">
            {solicitudes.map((s) => (
              <MiSolicitud
                key={s.id}
                solicitud={s}
                abrirAlLlegar={abrirHistorial === s.id}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
  const derechos = (
    <QueDerechosTiene
      key="derechos"
      plazo={plazo}
      onPedir={(tipo) => setPidiendo(tipo)}
    />
  );
  const descargar = <DescargarMisDatos key="descargar" />;

  return (
    <div className="mz-stack pv-mis-derechos">
      {tieneSolicitudes
        ? [misSolicitudes, derechos, descargar]
        : [derechos, descargar, misSolicitudes]}

      {pidiendo !== false && (
        <NuevaSolicitud
          plazoDias={plazo}
          tipoInicial={pidiendo}
          onCerrar={() => setPidiendo(false)}
          onEnviada={alEnviar}
        />
      )}
    </div>
  );
}

/** «2026-11-24» → «24/11/2026». */
function fechaCorta(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function QueDerechosTiene({ plazo, onPedir }) {
  // Se edita en «Protección de datos» → «Textos» (US-004, 11/11/2026); el
  // servidor ya reemplaza `{plazo}`. Mientras llega, el texto de siempre.
  const { texto } = useTextoVigente(
    CLAVES_TEXTO.DERECHOS_EXPLICACION,
    DERECHOS_EXPLICACION_RESPALDO,
    { plazo },
  );
  return (
    <section className="mz-card" aria-labelledby="pv-sus-derechos">
      <div className="mz-card-head">
        <h3 id="pv-sus-derechos">
          <Icon name="shield-lock" /> Sus derechos sobre sus datos personales
        </h3>
      </div>
      <div className="mz-card-body mz-stack">
        {/* Como en la vista previa de «Textos», con «N días» resaltado. */}
        <TextoDelAviso texto={texto} resaltar={`${plazo} días`} />
        {/* Cada tarjeta es el botón que abre la solicitud con su tipo ya
            elegido; la explicación va como descripción del botón. */}
        <ul className="pv-derechos">
          {TIPOS.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="pv-derechos__boton"
                aria-describedby={`pv-derecho-${t.id}`}
                onClick={() => onPedir(t.id)}
              >
                <Icon name={t.icono} /> {t.accion}
              </button>
              <span id={`pv-derecho-${t.id}`}>
                <ExplicacionDeTipo tipo={t} />
              </span>
            </li>
          ))}
        </ul>
        <p className="pv-nota mb-0">
          Para la eliminación: nada se borra automáticamente. La revisa y la
          hace a mano el equipo que atiende estas solicitudes, y algunos datos
          se conservan porque la ley obliga a guardarlos (por ejemplo, el rol de
          pagos y los registros de auditoría). Sus solicitudes solo las ven
          usted y ese equipo.
        </p>
      </div>
    </section>
  );
}

function DescargarMisDatos() {
  const [secciones, setSecciones] = useState(null);
  const [error, setError] = useState(null);

  const cargar = useCallback(() => {
    setError(null);
    privacidadService
      .secciones()
      .then(setSecciones)
      .catch((err) =>
        setError(
          errorDePrivacidad(err, "No se pudo cargar qué incluye la descarga.")
            .mensaje,
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <section className="mz-card" aria-labelledby="pv-descargar">
      <div className="mz-card-head">
        <h3 id="pv-descargar">Descargar mis datos</h3>
      </div>
      <div className="mz-card-body mz-stack">
        <p id="pv-descargar-ayuda" className="mb-0">
          Baje ahora mismo una copia de lo que la intranet guarda de usted, sin
          hacer una solicitud. El Excel se abre con cualquier hoja de cálculo;
          el JSON sirve para llevar sus datos a otro programa. El archivo es
          confidencial: guárdelo en un lugar seguro y no lo reenvíe.
        </p>
        <BotonesDeDescarga
          descargar={privacidadService.descargarMisDatos}
          describe="pv-descargar-ayuda"
        />
        <details className="pv-detalles">
          <summary>Qué incluye la descarga y qué no</summary>
          <div className="pv-detalles__cuerpo">
            <EstadoDeCarga
              cargando={secciones === null && !error}
              error={error}
              onReintentar={cargar}
            />
            {secciones && <ContenidoDeLaDescarga secciones={secciones} />}
          </div>
        </details>
      </div>
    </section>
  );
}

function ContenidoDeLaDescarga({ secciones }) {
  const incluye = secciones.secciones ?? [];
  const noIncluye = secciones.no_incluido ?? [];
  return (
    <div className="pv-contenido">
      <div>
        <h4 className="pv-subtitulo">Incluye</h4>
        <ul className="pv-secciones">
          {incluye.map((s) => (
            <li key={s.clave}>
              <span className="mz-strong">{s.titulo}</span>
              {s.descripcion && <span>: {s.descripcion}</span>}
              {s.solo_el_titular && (
                <span className="mz-faint">
                  {" "}
                  (solo usted puede descargarlo)
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="pv-subtitulo">No incluye</h4>
        <ul className="pv-secciones">
          {noIncluye.map((n) => (
            <li key={n.que}>
              <span className="mz-strong">{n.que}</span>
              {n.motivo && <span>: {n.motivo}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Una solicitud propia: estado, plazo, lo pedido, la respuesta y, a pedido,
 * el historial (la lista no lo trae: se pide al abrirlo). */
function MiSolicitud({ solicitud: s, abrirAlLlegar = false }) {
  const [abierto, setAbierto] = useState(false);
  const [historial, setHistorial] = useState(s.historial ?? null);
  const [error, setError] = useState(null);
  const idHistorial = `pv-historial-${s.id}`;

  const cargarHistorial = useCallback(() => {
    setError(null);
    privacidadService
      .miSolicitud(s.id)
      .then((d) => setHistorial(d.historial ?? []))
      .catch((err) =>
        setError(
          errorDePrivacidad(err, "No se pudo cargar el historial.").mensaje,
        ),
      );
  }, [s.id]);

  // Desde el aviso de esta solicitud: el historial ya abierto.
  useEffect(() => {
    if (!abrirAlLlegar) return;
    setAbierto(true);
    if (historial === null) cargarHistorial();
    // Solo cuando llega el pedido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirAlLlegar]);

  function alternar() {
    const abrir = !abierto;
    setAbierto(abrir);
    if (abrir && historial === null) cargarHistorial();
  }

  const tipo = TIPO[s.tipo];
  return (
    <li className="pv-solicitud">
      <div className="pv-solicitud__cabecera">
        <h4
          id={idDeMiSolicitud(s.id)}
          className="pv-solicitud__titulo"
          tabIndex={-1}
        >
          <span className="mz-mono">{s.numero}</span>
          <span className="visually-hidden">: </span>{" "}
          {tipo?.texto || s.tipo_label}
        </h4>
        <PildoraEstado estado={s.estado} texto={s.estado_label} />
      </div>
      <p className="mz-small mb-0">
        Enviada el {fechaHora(s.creada_en)} · <Plazo solicitud={s} />
      </p>
      {s.descripcion && (
        <div>
          <h5 className="pv-etiqueta">Lo que pidió</h5>
          <p className="pv-texto mb-0">{s.descripcion}</p>
        </div>
      )}
      {s.respuesta ? (
        <div className="pv-respuesta">
          <h5 className="pv-etiqueta">Respuesta de la empresa</h5>
          <p className="pv-texto mb-0">{s.respuesta}</p>
        </div>
      ) : (
        <p className="pv-nota mb-0">
          Todavía no tiene respuesta. Le llegará un aviso cuando cambie.
        </p>
      )}
      {s.tipo === "ELIMINACION" && !s.respuesta && (
        <p className="pv-nota mb-0">
          La eliminación la hace a mano el equipo que atiende; algunos datos se
          conservan por obligación legal y la respuesta le dirá cuáles.
        </p>
      )}
      <div>
        <button
          type="button"
          className="btn btn-link btn-sm px-0 pv-enlace"
          aria-expanded={abierto}
          aria-controls={idHistorial}
          onClick={alternar}
        >
          <Icon name={abierto ? "chevron-up" : "chevron-down"} />{" "}
          {abierto ? "Ocultar historial" : "Ver historial"}
          <span className="visually-hidden"> de {s.numero}</span>
        </button>
        <div id={idHistorial} hidden={!abierto} className="pv-historial-caja">
          {abierto && (
            <>
              <EstadoDeCarga
                cargando={historial === null && !error}
                error={error}
                onReintentar={cargarHistorial}
              />
              {historial && <Historial historial={historial} />}
            </>
          )}
        </div>
      </div>
    </li>
  );
}
