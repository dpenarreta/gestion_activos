/*
 * US-033. Las piezas de la sanción económica (monto fijo o porcentaje del
 * sueldo) y de la razón dentro del reglamento (documento institucional y
 * artículo), compartidas por emitir, solicitar y confirmar, el detalle y
 * «Mis llamados».
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { llamadosService } from "../../../api/llamadosService";
import { Campo } from "../../../components/common/Campo/Campo";
import { institucionalService } from "../../../api/institucionalService";
import { Icon } from "../../../components/common/Icon/Icon";
import { VisorPdf } from "../../../components/common/VisorPdf/VisorPdf";
import { mensajeDeError } from "../../../utils/errores";
import { formatearMoneda } from "../../../utils/formato";
import {
  FORMAS,
  SANCION,
  avisoDeTope,
  porSobreElTope,
  porcentajeANumero,
  sugeridoDe,
  tipoDe,
} from "./llamadosComunes";

export const SANCION_VACIA = { forma: "monto", monto: "", porcentaje: "" };
/** Cada radio con un área táctil de al menos 44 px. */
export const ESTILO_RADIO = {
  minHeight: "2.75rem",
  display: "flex",
  alignItems: "center",
};

export const NOTA_POR_CALCULAR =
  "El monto en USD se calculará cuando el sueldo esté disponible en el sistema (nómina).";

/** El aviso de que un porcentaje supera el tope. Siempre está en la página
 * (vacío mientras no aplique) para que el lector de pantalla anuncie el
 * cambio con cortesía y sin repetirlo con cada tecla. */
export function AvisoDeTope({ id, visible, tope }) {
  return (
    <div id={id} aria-live="polite">
      {visible && (
        <p className="mz-alert mz-alert--warn mb-0">
          <Icon name="exclamation-triangle" /> {avisoDeTope(tope)} No se podrá
          emitir.
        </p>
      )}
    </div>
  );
}

/** La sanción de un llamado para una celda o un dato: el texto sin partir y,
 * con porcentaje, que el monto queda por calcular. */
export function SancionDelLlamado({ llamado, nota = "corta" }) {
  const base =
    llamado.sancion_texto ||
    (tipoDe(llamado) === SANCION || llamado.monto
      ? formatearMoneda(llamado.monto)
      : "—");
  return (
    <>
      <span className="text-nowrap">{base}</span>
      {llamado.monto_por_calcular && (
        <div
          className="mz-small mz-faint"
          title={nota === "corta" ? NOTA_POR_CALCULAR : undefined}
        >
          {nota === "corta" ? "por calcular" : NOTA_POR_CALCULAR}
        </div>
      )}
    </>
  );
}

export const RAZON_VACIA = { documento: "", titulo: "", articulo: "" };

/** El estado de la sanción (forma, monto y porcentaje) y cómo parte de lo
 * sugerido por un nivel o una propuesta. */
export function useSancion(inicial = SANCION_VACIA) {
  const [sancion, setSancion] = useState(inicial);
  const cambiar = useCallback(
    (parche) => setSancion((s) => ({ ...s, ...parche })),
    [],
  );
  /** Parte de lo que sugiere la primera fuente que sugiera algo; si ninguna
   * sugiere, se deja lo que había. */
  const sugerir = useCallback((...fuentes) => {
    const sugerido = sugeridoDe(...fuentes);
    if (!sugerido) return;
    setSancion((s) =>
      sugerido.forma === "porcentaje"
        ? { ...s, forma: "porcentaje", porcentaje: sugerido.valor }
        : { ...s, forma: "monto", monto: sugerido.valor },
    );
  }, []);
  const reiniciar = useCallback(() => setSancion(SANCION_VACIA), []);
  return { sancion, cambiar, sugerir, reiniciar };
}

/**
 * La forma de la sanción (radios) y el valor de la forma elegida. Avisa si el
 * porcentaje supera el tope de la empresa y, con porcentaje, que el monto se
 * calcula cuando llegue el sueldo.
 */
export function CamposDeSancion({
  prefijo,
  sancion,
  onSancion,
  tope = null,
  errores = {},
  deshabilitado = false,
}) {
  const porcentaje = sancion.forma === "porcentaje";
  const valor = porcentajeANumero(sancion.porcentaje);
  const sobreElTope =
    porcentaje && valor !== null && porSobreElTope(valor, tope);
  const hayTope = tope !== null && tope !== undefined && tope !== "";
  return (
    <>
      <fieldset
        className="mz-campo"
        disabled={deshabilitado}
        aria-describedby={
          errores.forma_sancion ? `${prefijo}-forma-error` : undefined
        }
      >
        <legend className="form-label">
          Forma de la sanción
          <span className="mz-campo__obligatorio" aria-hidden="true">
            {" "}
            *
          </span>
          <span className="visually-hidden"> (obligatorio)</span>
        </legend>
        <div className="d-flex flex-wrap gap-3">
          {Object.entries(FORMAS).map(([clave, texto]) => (
            <div className="form-check" key={clave} style={ESTILO_RADIO}>
              <input
                id={`${prefijo}-forma-${clave}`}
                type="radio"
                name={`${prefijo}-forma`}
                className="form-check-input"
                checked={sancion.forma === clave}
                onChange={() => onSancion({ forma: clave })}
              />
              <label
                className="form-check-label"
                htmlFor={`${prefijo}-forma-${clave}`}
              >
                {texto}
              </label>
            </div>
          ))}
        </div>
        {errores.forma_sancion && (
          <div
            id={`${prefijo}-forma-error`}
            className="mz-field-error"
            role="alert"
          >
            {errores.forma_sancion}
          </div>
        )}
      </fieldset>
      {porcentaje ? (
        <>
          <Campo
            id={`${prefijo}-porcentaje`}
            etiqueta="Porcentaje de la sanción (%)"
            obligatorio
            error={errores.porcentaje}
            ayuda={
              hayTope
                ? `Tope de la empresa: ${String(Number(tope)).replace(".", ",")} % del sueldo. ${NOTA_POR_CALCULAR}`
                : `${NOTA_POR_CALCULAR} Gestión Humana valida el porcentaje con el Código del Trabajo.`
            }
          >
            <input
              className="form-control"
              inputMode="decimal"
              value={sancion.porcentaje}
              aria-describedby={
                sobreElTope && !errores.porcentaje
                  ? `${prefijo}-porcentaje-tope`
                  : undefined
              }
              disabled={deshabilitado}
              onChange={(e) => onSancion({ porcentaje: e.target.value })}
            />
          </Campo>
          <AvisoDeTope
            id={`${prefijo}-porcentaje-tope`}
            visible={sobreElTope && !errores.porcentaje}
            tope={tope}
          />
        </>
      ) : (
        <Campo
          id={`${prefijo}-monto`}
          etiqueta="Monto de la sanción (USD)"
          obligatorio
          error={errores.monto}
          ayuda="Parte del monto sugerido del nivel. Gestión Humana valida los montos con el Código del Trabajo."
        >
          <input
            className="form-control"
            inputMode="decimal"
            value={sancion.monto}
            disabled={deshabilitado}
            onChange={(e) => onSancion({ monto: e.target.value })}
          />
        </Campo>
      )}
    </>
  );
}

/** Si se elige el documento falta el artículo, y al revés. */
export function erroresDeRazon({ documento, articulo }) {
  const errores = {};
  if (documento && !articulo.trim()) {
    errores.articulo = "Indique el artículo o numeral del documento.";
  }
  if (!documento && articulo.trim()) {
    errores.documento = "Elija el documento donde está el artículo.";
  }
  if (articulo.length > 120) {
    errores.articulo = "El artículo no puede pasar de 120 caracteres.";
  }
  return errores;
}

/**
 * La razón dentro del reglamento: el documento institucional (se trae de
 * `documentos/`) y el artículo o numeral. Opcional, pero lo uno exige lo
 * otro. `actual` es el documento ya guardado en el llamado: si se retiró,
 * sigue ofreciéndose para no perderlo sin querer.
 */
export function CamposDeRazon({
  prefijo,
  razon,
  onRazon,
  actual = null,
  errores = {},
  deshabilitado = false,
}) {
  const [documentos, setDocumentos] = useState(null);
  const [error, setError] = useState(null);
  const [vez, setVez] = useState(0);

  useEffect(() => {
    let vigente = true;
    setError(null);
    llamadosService
      .documentos()
      .then((lista) => vigente && setDocumentos(lista))
      .catch(
        (err) =>
          vigente &&
          setError(
            mensajeDeError(err, "No se pudieron cargar los documentos."),
          ),
      );
    return () => {
      vigente = false;
    };
  }, [vez]);

  const lista = documentos ?? [];
  const falta =
    actual?.id != null &&
    !lista.some((d) => String(d.id) === String(actual.id));
  return (
    <>
      {error && (
        <div className="mz-alert mz-alert--warn" role="alert">
          <span className="flex-grow-1">
            {error} Puede continuar sin la razón del reglamento.
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm mz-tactil"
            onClick={() => setVez((v) => v + 1)}
          >
            Reintentar
          </button>
        </div>
      )}
      <Campo
        id={`${prefijo}-documento`}
        etiqueta="Documento del reglamento"
        error={errores.documento}
        ayuda={
          documentos === null && !error ? (
            <span role="status">Cargando documentos…</span>
          ) : documentos && lista.length === 0 ? (
            "No hay documentos institucionales activos. Se publican en «Códigos de conducta»."
          ) : (
            "Opcional. El documento institucional donde está la norma incumplida."
          )
        }
      >
        <select
          className="form-select"
          value={razon.documento}
          disabled={deshabilitado || (documentos === null && !error)}
          onChange={(e) => {
            const id = e.target.value;
            const elegido = lista.find((d) => String(d.id) === id);
            onRazon({
              documento: id,
              titulo: elegido?.titulo ?? (id ? (actual?.titulo ?? "") : ""),
            });
          }}
        >
          <option value="">Sin documento</option>
          {falta && (
            <option value={actual.id}>
              {actual.titulo} (ya no está disponible)
            </option>
          )}
          {lista.map((d) => (
            <option key={d.id} value={d.id}>
              {d.titulo}
              {d.version ? ` · versión ${d.version}` : ""}
            </option>
          ))}
        </select>
      </Campo>
      <Campo
        id={`${prefijo}-articulo`}
        etiqueta="Artículo o numeral"
        obligatorio={Boolean(razon.documento)}
        error={errores.articulo}
        ayuda="Por ejemplo: Art. 45, lit. c"
      >
        <input
          className="form-control"
          value={razon.articulo}
          maxLength={120}
          disabled={deshabilitado}
          onChange={(e) => onRazon({ articulo: e.target.value })}
        />
      </Campo>
    </>
  );
}

/** El código del error del servidor; en una descarga el cuerpo llega como
 * blob y hay que leerlo. */
async function codigoDelError(err) {
  let datos = err?.response?.data;
  try {
    if (typeof Blob !== "undefined" && datos instanceof Blob) {
      datos = JSON.parse(await datos.text());
    }
  } catch {
    return null;
  }
  return datos?.error?.code ?? null;
}

/**
 * La razón de un llamado ya guardado: el documento y el artículo. Un PDF
 * disponible se abre en el visor interno (no se descarga); si no es PDF o se
 * retiró, solo el título. Sin documento ni artículo no pinta nada.
 */
export function RazonDelLlamado({ llamado }) {
  const [abierto, setAbierto] = useState(null);
  const [abriendo, setAbriendo] = useState(false);
  const [error, setError] = useState(null);
  const documento = llamado?.documento ?? null;
  const articulo = llamado?.articulo ?? "";
  const titulo = documento?.titulo ?? "";
  if (!documento && !articulo && !llamado?.razon) return null;
  const disponible = Boolean(documento?.disponible && documento?.url);
  const verEnVisor = disponible && documento.es_pdf;

  async function abrir() {
    setError(null);
    setAbriendo(true);
    try {
      const blob = await institucionalService.archivoDocumento(documento.id);
      setAbierto(blob);
    } catch (err) {
      if (err?.response?.status === 403) {
        setError(
          (await codigoDelError(err)) === "acuerdo_pendiente"
            ? "No puede ver el documento todavía: acepte el acuerdo de confidencialidad en «Códigos de conducta»."
            : "No puede abrir este documento.",
        );
      } else {
        setError(mensajeDeError(err, "No se pudo abrir el documento."));
      }
    } finally {
      setAbriendo(false);
    }
  }

  let parteDocumento = null;
  if (documento) {
    if (verEnVisor) {
      parteDocumento = (
        <button
          type="button"
          className="btn btn-link p-0 align-baseline mz-tactil"
          disabled={abriendo}
          onClick={abrir}
        >
          {abriendo ? "Abriendo…" : titulo}
          <span className="visually-hidden"> (abrir el documento)</span>
        </button>
      );
    } else if (!disponible) {
      parteDocumento = (
        <span className="mz-faint mz-small">{titulo} (documento retirado)</span>
      );
    } else {
      parteDocumento = titulo;
    }
  }
  return (
    <>
      <span>
        {parteDocumento}
        {documento && articulo ? ", " : ""}
        {articulo}
        {!documento && !articulo ? llamado.razon : ""}
      </span>
      {error && (
        <div className="mz-alert mz-alert--bad mt-1" role="alert">
          {error}
        </div>
      )}
      {abierto &&
        createPortal(
          <VisorPdf
            titulo={titulo}
            blob={abierto}
            nombreArchivo={titulo}
            onCerrar={() => setAbierto(null)}
          />,
          document.body,
        )}
    </>
  );
}
