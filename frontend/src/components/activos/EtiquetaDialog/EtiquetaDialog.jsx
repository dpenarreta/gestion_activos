import { useCallback, useEffect, useState } from "react";

import { activosService } from "../../../api/activosService";
import { Icon } from "../../common/Icon/Icon";
import { ModalDialog } from "../../common/ModalDialog/ModalDialog";
import { mensajeDeError } from "../../../utils/errores";
import "./EtiquetaDialog.css";
import { descargarBlob } from "../../../utils/descargas";

const FORMATOS_TERMICOS = [
  { valor: "zpl", etiqueta: "ZPL — Zebra y compatibles" },
  { valor: "tspl", etiqueta: "TSPL — TSC, Godex y compatibles" },
];

const EXTENSIONES = { zpl: "zpl", tspl: "txt" };

/* Las dos simbologías, con la advertencia puesta donde se decide y no en un
   manual: elegir QR sin tener lectores de imagen deja etiquetas que la
   pistola de bodega no puede leer, y eso no se descubre hasta que alguien
   está delante del equipo con el lector en la mano. */
const SIMBOLOGIAS = [
  {
    valor: "code128",
    etiqueta: "Código de barras (Code 128)",
    nota: "Lo lee cualquier pistola, incluidas las láser de un solo haz.",
  },
  {
    valor: "qr",
    etiqueta: "Código QR",
    nota: "Necesita lector de imagen o la cámara de un teléfono: una pistola láser no lo lee.",
  },
];

/**
 * Etiqueta de un activo, en PDF o como trabajo de impresión térmica (RF-08).
 *
 * El PDF es lo que se descarga: lo abre cualquiera, se revisa antes de gastar
 * consumibles y sirve también para una impresora común. Los lenguajes
 * térmicos (ZPL/TSPL) quedan a mano en la segunda sección, para enviar el
 * trabajo directamente a la cola de una impresora de etiquetas.
 *
 * La vista previa es el PDF real embebido, no una imitación en HTML: una
 * maqueta con CSS podría diferir del documento que sale impreso, que es
 * justamente lo que la previsualización debería evitar.
 */
export function EtiquetaDialog({ activo, onCerrar }) {
  const [urlPrevia, setUrlPrevia] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [formatoTermico, setFormatoTermico] = useState("zpl");
  const [simbologia, setSimbologia] = useState("code128");
  const [contenidoTermico, setContenidoTermico] = useState("");
  const [mostrarTermico, setMostrarTermico] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [medicion, setMedicion] = useState(null);

  useEffect(() => {
    let urlCreada = null;
    let cancelado = false;

    activosService
      .previsualizarPdf(activo.id, simbologia)
      .then((blob) => {
        if (cancelado) return;
        urlCreada = URL.createObjectURL(blob);
        setUrlPrevia(urlCreada);
      })
      .catch((err) => {
        if (!cancelado)
          setError(mensajeDeError(err, "No se pudo generar la etiqueta."));
      })
      .finally(() => {
        if (!cancelado) setIsLoading(false);
      });

    // La medición del símbolo, para poder avisar antes de imprimir un lote
    // en vez de descubrirlo con el lector en la mano.
    activosService
      .medicionEtiqueta(activo.id)
      .then((datos) => {
        if (!cancelado) setMedicion(datos);
      })
      .catch(() => undefined);

    return () => {
      cancelado = true;
      // Liberar el object URL al cerrar: si no, el blob queda retenido en
      // memoria mientras viva la pestaña.
      if (urlCreada) URL.revokeObjectURL(urlCreada);
    };
  }, [activo.id, simbologia]);

  const cargarTermico = useCallback(() => {
    activosService
      .etiqueta(activo.id, formatoTermico, simbologia)
      .then((datos) => setContenidoTermico(datos.contenido))
      .catch((err) =>
        setError(
          mensajeDeError(err, "No se pudo generar el trabajo de impresión."),
        ),
      );
  }, [activo.id, formatoTermico, simbologia]);

  useEffect(() => {
    if (mostrarTermico) {
      cargarTermico();
    }
  }, [mostrarTermico, cargarTermico]);

  async function handleDescargarPdf() {
    try {
      const blob = await activosService.descargarEtiqueta(
        activo.id,
        "pdf",
        simbologia,
      );
      descargarBlob(blob, `etiqueta-${activo.codigo_barras}.pdf`);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo descargar la etiqueta."));
    }
  }

  async function handleDescargarTermico() {
    try {
      const blob = await activosService.descargarEtiqueta(
        activo.id,
        formatoTermico,
        simbologia,
      );
      descargarBlob(
        blob,
        `etiqueta-${activo.codigo_barras}.${EXTENSIONES[formatoTermico]}`,
      );
    } catch (err) {
      setError(
        mensajeDeError(err, "No se pudo descargar el trabajo de impresión."),
      );
    }
  }

  async function handleCopiar() {
    try {
      await navigator.clipboard.writeText(contenidoTermico);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // El portapapeles puede estar bloqueado (contexto no seguro, permiso
      // denegado). El contenido sigue visible y seleccionable a mano.
      setError(
        "El navegador bloqueó el acceso al portapapeles. Copie el texto manualmente.",
      );
    }
  }

  return (
    <ModalDialog
      titulo="Etiqueta del activo"
      subtitulo={`${activo.codigo_barras} · ${activo.nombre}`}
      onCerrar={onCerrar}
      anchoMaximo="46rem"
    >
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <p className="mz-faint mz-small">
        Etiqueta de 50 × 25 mm con el código en{" "}
        {simbologia === "qr" ? "QR" : "Code 128"}. El PDF sale a tamaño real:
        imprímalo «a escala 100 %», sin ajustar a página.
      </p>

      <div className="mz-field mb-3">
        <label htmlFor="simbologia-etiqueta">Tipo de código</label>
        <select
          id="simbologia-etiqueta"
          className="form-select form-select-sm"
          value={simbologia}
          onChange={(evento) => {
            setSimbologia(evento.target.value);
            setIsLoading(true);
          }}
        >
          {SIMBOLOGIAS.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.etiqueta}
            </option>
          ))}
        </select>
        <div className="form-text">
          {SIMBOLOGIAS.find((opcion) => opcion.valor === simbologia)?.nota}
        </div>
      </div>

      <div className="etiqueta-previa-pdf mb-3">
        {isLoading && <p className="mz-empty m-0">Generando la etiqueta…</p>}
        {urlPrevia && (
          <object
            data={urlPrevia}
            type="application/pdf"
            aria-label={`Vista previa de la etiqueta ${activo.codigo_barras}`}
          >
            {/* Algunos navegadores (y varios móviles) no embeben PDF: el
                enlace es el respaldo, no un adorno. */}
            <p className="p-3 mb-0">
              Su navegador no puede mostrar el PDF incrustado.{" "}
              <a href={urlPrevia} target="_blank" rel="noreferrer">
                Ábralo en una pestaña nueva
              </a>
              .
            </p>
          </object>
        )}
      </div>

      {medicion && simbologia !== "qr" && (
        <LegibilidadDelCodigo medicion={medicion} />
      )}

      <div className="d-flex gap-2 flex-wrap">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleDescargarPdf}
          disabled={isLoading}
        >
          <Icon name="file-earmark-pdf" /> Descargar PDF
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => setMostrarTermico((valor) => !valor)}
          aria-expanded={mostrarTermico}
        >
          <Icon name="printer" />{" "}
          {mostrarTermico ? "Ocultar" : "Impresión térmica directa"}
        </button>
      </div>

      {mostrarTermico && (
        <section className="etiqueta-termica mt-3">
          <p className="mz-faint mz-small">
            Para enviar el trabajo directamente a la cola de una impresora de
            etiquetas, sin pasar por el PDF.
          </p>

          <label className="form-label" htmlFor="formato-etiqueta">
            Lenguaje de la impresora
          </label>
          <select
            id="formato-etiqueta"
            className="form-select mb-3"
            value={formatoTermico}
            onChange={(event) => setFormatoTermico(event.target.value)}
          >
            {FORMATOS_TERMICOS.map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>
                {opcion.etiqueta}
              </option>
            ))}
          </select>

          <label className="form-label" htmlFor="contenido-etiqueta">
            Trabajo de impresión
          </label>
          <textarea
            id="contenido-etiqueta"
            className="form-control etiqueta-contenido"
            rows={8}
            readOnly
            value={contenidoTermico || "Generando…"}
          />

          <div className="d-flex gap-2 mt-2">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={handleDescargarTermico}
              disabled={!contenidoTermico}
            >
              <Icon name="download" /> Descargar .{EXTENSIONES[formatoTermico]}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={handleCopiar}
              disabled={!contenidoTermico}
            >
              <Icon name={copiado ? "check2" : "clipboard"} />{" "}
              {copiado ? "Copiado" : "Copiar al portapapeles"}
            </button>
          </div>
        </section>
      )}
    </ModalDialog>
  );
}

/**
 * Aviso sobre si el código impreso se dejará leer por una pistola.
 *
 * Lo que decide la lectura no es el formato del archivo sino tres medidas
 * físicas: el ancho de la barra más fina, la zona muda a los lados y la
 * altura. Se muestran aquí para poder comprobarlo antes de mandar a imprimir
 * doscientas etiquetas, en vez de descubrirlo con el lector en la mano.
 *
 * Ninguna medida sustituye a escanear una etiqueta impresa: la legibilidad
 * final depende también del material, del contraste y de la calibración de la
 * impresora.
 */
function LegibilidadDelCodigo({ medicion }) {
  const correcto = medicion.cabe && medicion.cumple_minimo;

  return (
    <div
      className={`mz-alert ${correcto ? "mz-alert--info" : "mz-alert--warn"}`}
      role="status"
    >
      <Icon name={correcto ? "check2-circle" : "exclamation-triangle"} />
      <div>
        <strong>{medicion.simbologia}</strong> · barra más fina{" "}
        {medicion.ancho_modulo_mm.toFixed(2)} mm · zona muda{" "}
        {medicion.quiet_zone_mm.toFixed(1)} mm · alto {medicion.alto_barras_mm}{" "}
        mm
        {correcto ? (
          <span className="d-block">
            Dentro de lo que lee una pistola láser común, incluida la Zebra.
          </span>
        ) : (
          <span className="d-block">
            El código es demasiado largo para esta etiqueta: quedaría por debajo
            del mínimo legible. Use una etiqueta más ancha antes de imprimir el
            lote.
          </span>
        )}
      </div>
    </div>
  );
}
