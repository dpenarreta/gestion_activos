import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "../Icon/Icon";

/** El PDF detrás de cada dirección `blob:` creada por el sistema: pdf.js lo
 * lee de memoria, sin pedirlo por la red (la CSP, `connect-src 'self'`, no
 * deja traer direcciones `blob:`). */
const pdfPorUrl = new Map();

export function registrarPdf(url, blob) {
  pdfPorUrl.set(url, blob);
}

export function olvidarPdf(url) {
  pdfPorUrl.delete(url);
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

/**
 * El lector de PDF del sistema (30/10/2026): dibuja el documento con pdf.js,
 * una página a la vez, con «Anterior» / «Siguiente», «Página x de y», zoom y
 * las flechas del teclado. Se ve igual en computador, Android e iPhone (el
 * lector del navegador dentro de un marco no muestra el PDF en Android y en
 * iPhone solo la primera página) y lleva el título del documento, no un
 * código. El texto de cada página va también oculto en la página, para el
 * lector de pantalla.
 *
 * pdf.js se carga solo al abrir un PDF; sin `eval` (la CSP no lo permite).
 */
export function LectorPdf({ titulo, url }) {
  const marco = useRef(null);
  const lienzo = useRef(null);
  const [documento, setDocumento] = useState(null);
  const [pagina, setPagina] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState("cargando");
  const [ancho, setAncho] = useState(0);

  // El ancho del marco: al girar el teléfono o abrir el menú, se redibuja.
  useEffect(() => {
    const elemento = marco.current;
    if (!elemento || typeof ResizeObserver === "undefined") return undefined;
    const observador = new ResizeObserver(([entrada]) =>
      setAncho(Math.round(entrada.contentRect.width)),
    );
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [estado]);

  // En el visor (una ventana), el foco pasa al documento al cargarlo: las
  // flechas funcionan nada más abrir. Dentro de una página no se lo quita a
  // nadie.
  useEffect(() => {
    if (estado !== "listo" || !marco.current) return;
    const ventana = marco.current.closest('[role="dialog"]');
    if (ventana?.contains(document.activeElement))
      marco.current.focus({ preventScroll: true });
  }, [estado]);

  useEffect(() => {
    if (!url) return undefined;
    let vigente = true;
    let tarea = null;
    setEstado("cargando");
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          const trabajador =
            await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
          // «?v=2»: la primera publicación respondió 404 a este archivo y
          // el servidor lo dejó en la caché del navegador por un año.
          pdfjs.GlobalWorkerOptions.workerSrc = `${trabajador.default}?v=2`;
        }
        const blob = pdfPorUrl.get(url);
        const origen = blob
          ? { data: new Uint8Array(await blob.arrayBuffer()) }
          : { url };
        if (!vigente) return;
        tarea = pdfjs.getDocument({ ...origen, isEvalSupported: false });
        const cargado = await tarea.promise;
        if (!vigente) {
          cargado.destroy();
          return;
        }
        setDocumento(cargado);
        setPagina(1);
        setEstado("listo");
      } catch {
        if (vigente) setEstado("error");
      }
    })();
    return () => {
      vigente = false;
      tarea?.destroy?.();
    };
  }, [url]);

  // Dibuja la página al ancho del marco (por el zoom), nítida en pantallas
  // de alta densidad.
  useEffect(() => {
    if (!documento || !lienzo.current || !marco.current) return undefined;
    let vigente = true;
    let dibujo = null;
    (async () => {
      const pag = await documento.getPage(pagina);
      if (!vigente) return;
      const base = pag.getViewport({ scale: 1 });
      const disponible = Math.max(240, marco.current.clientWidth - 32);
      const escala = (disponible / base.width) * zoom;
      const vista = pag.getViewport({ scale: escala });
      const densidad = window.devicePixelRatio || 1;
      const canvas = lienzo.current;
      canvas.width = Math.floor(vista.width * densidad);
      canvas.height = Math.floor(vista.height * densidad);
      canvas.style.width = `${Math.floor(vista.width)}px`;
      canvas.style.height = `${Math.floor(vista.height)}px`;
      const contexto = canvas.getContext("2d");
      dibujo = pag.render({
        canvasContext: contexto,
        viewport: vista,
        transform: densidad !== 1 ? [densidad, 0, 0, densidad, 0, 0] : null,
      });
      try {
        await dibujo.promise;
      } catch {
        return;
      }
      const contenido = await pag.getTextContent();
      if (vigente) setTexto(contenido.items.map((i) => i.str).join(" "));
      marco.current?.scrollTo?.({ top: 0 });
    })();
    return () => {
      vigente = false;
      dibujo?.cancel?.();
    };
  }, [documento, pagina, zoom, ancho]);

  const total = documento?.numPages ?? 0;
  const ir = useCallback(
    (n) => setPagina((p) => Math.min(Math.max(1, n ?? p), total || 1)),
    [total],
  );
  const acercar = (delta) =>
    setZoom((z) =>
      Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 4) / 4)),
    );

  function teclas(evento) {
    if (evento.target.closest("button")) return;
    const accion = {
      ArrowRight: () => ir(pagina + 1),
      PageDown: () => ir(pagina + 1),
      ArrowLeft: () => ir(pagina - 1),
      PageUp: () => ir(pagina - 1),
      Home: () => ir(1),
      End: () => ir(total),
    }[evento.key];
    if (accion) {
      evento.preventDefault();
      accion();
    }
  }

  if (!url || estado === "cargando")
    return (
      <p className="mz-faint lector-pdf__aviso" role="status">
        Cargando el documento…
      </p>
    );
  if (estado === "error")
    return (
      <div className="mz-alert mz-alert--bad lector-pdf__aviso" role="alert">
        <Icon name="x-octagon" />
        <span>
          No se pudo mostrar el documento aquí. Puede descargarlo para leerlo.
        </span>
      </div>
    );

  return (
    <div className="lector-pdf">
      <div className="lector-pdf__barra" role="toolbar" aria-label="Lectura">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={pagina <= 1}
          onClick={() => ir(pagina - 1)}
          aria-label="Página anterior"
          title="Página anterior"
        >
          <Icon name="chevron-left" />
        </button>
        <span className="lector-pdf__pagina" aria-live="polite">
          Página <strong>{pagina}</strong> de {total}
        </span>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={pagina >= total}
          onClick={() => ir(pagina + 1)}
          aria-label="Página siguiente"
          title="Página siguiente"
        >
          <Icon name="chevron-right" />
        </button>
        <span className="lector-pdf__separador" aria-hidden="true" />
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={zoom <= ZOOM_MIN}
          onClick={() => acercar(-0.25)}
          aria-label="Alejar"
          title="Alejar"
        >
          <Icon name="zoom-out" />
        </button>
        <span className="lector-pdf__zoom">{Math.round(zoom * 100)} %</span>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={zoom >= ZOOM_MAX}
          onClick={() => acercar(0.25)}
          aria-label="Acercar"
          title="Acercar"
        >
          <Icon name="zoom-in" />
        </button>
        {zoom !== 1 && (
          <button
            type="button"
            className="btn btn-link btn-sm"
            onClick={() => setZoom(1)}
          >
            Ajustar al ancho
          </button>
        )}
      </div>
      {/* Una región que se desplaza: se enfoca con Tab y responde a las
          flechas (WCAG 2.1.1). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={marco}
        className="lector-pdf__marco"
        role="region"
        aria-label={`Documento: ${titulo}, página ${pagina} de ${total}`}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        onKeyDown={teclas}
      >
        <canvas
          ref={lienzo}
          className="lector-pdf__lienzo"
          aria-hidden="true"
        />
        <div className="visually-hidden">{texto}</div>
      </div>
    </div>
  );
}
