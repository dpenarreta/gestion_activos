/*
 * Piezas compartidas por «Mis derechos» (perfil del titular) y la bandeja de
 * quien atiende: el estado, el plazo, el historial, los avisos y los botones
 * de descarga. El color nunca va solo: cada píldora dice su texto y lleva su
 * ícono.
 */
import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "../../components/common/Icon/Icon";
import { useTextoVigente } from "../../hooks/useTextoVigente";
import { fecha, fechaHora } from "../GestionHumana/comunes";
import { errorDePrivacidad } from "../../api/privacidadService";
import {
  ESTADO,
  TIPO,
  textoDeDiasRestantes,
  textoDeEstado,
} from "./privacidadComunes";

/**
 * La explicación de un tipo de solicitud: la del catálogo de textos (US-004,
 * se edita en «Protección de datos» → «Textos») y, mientras llega o si no
 * llega, la de siempre. No se acepta: el respaldo basta para leerla.
 */
export function ExplicacionDeTipo({ tipo }) {
  const { texto } = useTextoVigente(tipo.clave, tipo.explicacion);
  return texto;
}

export function PildoraEstado({ estado, texto }) {
  const e = ESTADO[estado];
  return (
    <span className={`mz-pill mz-pill--${e?.tono ?? "neutral"}`}>
      {e && <Icon name={e.icono} />}
      {textoDeEstado(estado, texto)}
    </span>
  );
}

export function PildoraTipo({ tipo, texto }) {
  const t = TIPO[tipo];
  return (
    <span className="mz-pill mz-pill--neutral">
      {t && <Icon name={t.icono} />}
      {t?.texto || texto || tipo}
    </span>
  );
}

/** «Vencida», con texto: el rojo solo no basta. */
export function PildoraVencida() {
  return (
    <span className="mz-pill mz-pill--bad">
      <Icon name="exclamation-octagon" /> Vencida
    </span>
  );
}

/**
 * La fecha límite y cuánto falta, o cuándo se respondió si ya está cerrada.
 * `compacto`: en una línea, para la tabla y las tarjetas.
 */
export function Plazo({ solicitud, compacto = false }) {
  const abierta =
    solicitud.dias_restantes !== null && solicitud.dias_restantes !== undefined;
  const restantes = textoDeDiasRestantes(solicitud.dias_restantes);
  if (!abierta) {
    return (
      <span className="pv-plazo">
        {solicitud.resuelta_en
          ? `Respondida el ${fechaHora(solicitud.resuelta_en)}`
          : `Fecha límite: ${fecha(solicitud.fecha_limite)}`}
      </span>
    );
  }
  return (
    <span
      className={`pv-plazo${solicitud.vencida ? " pv-plazo--vencida" : ""}`}
    >
      {compacto ? "" : "Fecha límite: "}
      <span className="mz-strong">{fecha(solicitud.fecha_limite)}</span>
      {restantes && <span> · {restantes}</span>}
      {solicitud.vencida && (
        <>
          {" "}
          <PildoraVencida />
        </>
      )}
    </span>
  );
}

/**
 * Cada cambio de estado con su fecha y la respuesta. `conActor`: quien
 * atiende ve además quién lo movió (el titular no: trata con la empresa, no
 * con una persona).
 */
export function Historial({ historial = [], conActor = false }) {
  if (historial.length === 0) {
    return (
      <p className="mz-small mz-faint mb-0">Todavía no tiene movimientos.</p>
    );
  }
  return (
    <ol className="pv-historial">
      {historial.map((h, i) => (
        <li key={`${h.fecha}-${i}`}>
          <p className="mb-1">
            {h.estado_anterior ? (
              <>
                <span className="mz-strong">
                  {textoDeEstado(h.estado_anterior)}
                </span>{" "}
                <Icon name="arrow-right" />
                <span className="visually-hidden"> a </span>{" "}
                <span className="mz-strong">
                  {textoDeEstado(h.estado_nuevo, h.estado_nuevo_label)}
                </span>
              </>
            ) : (
              <span className="mz-strong">Solicitud recibida</span>
            )}
          </p>
          <p className="mz-small mz-faint mb-0">
            {fechaHora(h.fecha)}
            {conActor && h.actor ? ` · ${h.actor.nombre}` : ""}
          </p>
          {h.respuesta && (
            <p className="pv-texto mz-small mb-0 mt-1">{h.respuesta}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

const ICONO_AVISO = {
  ok: "check2-circle",
  warn: "exclamation-triangle",
  bad: "x-octagon",
  info: "info-circle",
};

/**
 * El resultado de una acción. La región viva está siempre montada (una que
 * aparece ya con su texto no se anuncia en varios lectores); dentro se pinta
 * el aviso visible. `avisoRef` recibe el foco cuando la pantalla lo pide
 * (tras un 409, para leer qué pasó).
 */
export function AvisoVivo({ aviso, onCerrar, avisoRef }) {
  const tono = aviso?.tono ?? "ok";
  return (
    <div role="status" aria-live="polite" className="pv-aviso">
      {aviso && (
        <div
          ref={avisoRef}
          tabIndex={-1}
          className={`mz-alert mz-alert--${tono}`}
        >
          <Icon name={ICONO_AVISO[tono]} />
          <span className="flex-grow-1">{aviso.texto}</span>
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
      )}
    </div>
  );
}

const FORMATOS = [
  {
    id: "xlsx",
    texto: "Descargar en Excel",
    icono: "file-earmark-excel",
  },
  { id: "json", texto: "Descargar en JSON", icono: "filetype-json" },
];

/**
 * «Descargar en Excel» y «Descargar en JSON». Mientras descarga, el botón no
 * se deshabilita (el foco caería en `<body>`): queda `aria-disabled` con
 * «Descargando…», y un `useRef` evita el doble clic. Si falla (también el
 * 429 del límite de descargas), el error va junto a los botones y el foco
 * pasa a «Reintentar».
 *
 * @param {(formato: "xlsx"|"json") => Promise<string>} descargar devuelve el
 *   nombre del archivo
 * @param {string} [sufijo] lo que se agrega al nombre accesible de cada
 *   botón («del titular»)
 * @param {string} [describe] id del texto que explica la descarga
 */
export function BotonesDeDescarga({ descargar, sufijo = "", describe }) {
  const [descargando, setDescargando] = useState(null);
  const [error, setError] = useState(null);
  const [listo, setListo] = useState("");
  const enCurso = useRef(false);
  const ultimo = useRef("xlsx");
  const reintentar = useRef(null);
  const idError = `${useId()}-error`;

  useEffect(() => {
    if (error) reintentar.current?.focus();
  }, [error]);

  async function bajar(formato) {
    if (enCurso.current) return;
    enCurso.current = true;
    ultimo.current = formato;
    setDescargando(formato);
    setError(null);
    setListo("");
    try {
      const nombre = await descargar(formato);
      setListo(`Descarga lista: ${nombre}.`);
    } catch (err) {
      setError(
        errorDePrivacidad(
          err,
          "No se pudo preparar el archivo. Inténtelo de nuevo en un momento.",
        ).mensaje,
      );
    } finally {
      enCurso.current = false;
      setDescargando(null);
    }
  }

  return (
    <div className="pv-descarga">
      <div className="pv-acciones">
        {FORMATOS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`btn btn-sm ${f.id === "xlsx" ? "btn-exportar" : "btn-outline-secondary"}`}
            aria-disabled={descargando ? "true" : undefined}
            aria-describedby={
              [describe, error ? idError : null].filter(Boolean).join(" ") ||
              undefined
            }
            onClick={() => bajar(f.id)}
          >
            {descargando === f.id ? (
              <span
                className="spinner-border spinner-border-sm"
                aria-hidden="true"
              />
            ) : (
              <Icon name={f.icono} />
            )}{" "}
            {descargando === f.id ? "Descargando…" : f.texto}
            {sufijo && descargando !== f.id && (
              <span className="visually-hidden"> {sufijo}</span>
            )}
          </button>
        ))}
      </div>
      {/* La región viva siempre montada (así se anuncia); dentro, el aviso
          visible con el nombre del archivo, para quien no ve la barra de
          descargas del navegador. */}
      <div role="status" className="pv-descarga__listo">
        {listo && (
          <p className="mz-alert mz-alert--ok mb-0">
            <Icon name="check2-circle" />
            <span>{listo}</span>
          </p>
        )}
      </div>
      {error && (
        <div className="mz-alert mz-alert--bad pv-descarga__error" role="alert">
          <Icon name="x-octagon" />
          <span id={idError} className="flex-grow-1">
            {error}
          </span>
          <button
            ref={reintentar}
            type="button"
            className="btn btn-sm btn-outline-danger"
            aria-disabled={descargando ? "true" : undefined}
            onClick={() => bajar(ultimo.current)}
          >
            <Icon name="arrow-clockwise" /> Reintentar
          </button>
        </div>
      )}
    </div>
  );
}
