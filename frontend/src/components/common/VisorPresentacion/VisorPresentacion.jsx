import { useCallback, useEffect, useRef, useState } from "react";

import { useModalA11y } from "../../../hooks/useModalA11y";
import { descargarBlob } from "../../../utils/descargas";
import { Icon } from "../Icon/Icon";
import "../VisorPdf/VisorPdf.css";
import "./VisorPresentacion.css";

/** Si un archivo es una presentación que se puede dibujar aquí (.pptx; el
 * .ppt antiguo es binario y no se puede leer en el navegador). */
export function esPresentacion(nombre = "") {
  return /\.pptx$/i.test(nombre);
}

/**
 * El visor de presentaciones del sistema (30/10/2026): la .pptx se dibuja
 * dentro de la herramienta, una diapositiva a la vez, con «Anterior» y
 * «Siguiente» (también con las flechas del teclado), sin descargarla ni salir
 * del sistema. Hermano de `VisorPdf`.
 *
 * Usa `pptx-preview`, que se carga solo al abrir una presentación (es pesada).
 * La fidelidad no es la de PowerPoint: tipografías, SmartArt o animaciones
 * pueden verse distintas; por eso se ofrece también descargarla.
 */
export function VisorPresentacion({ titulo, blob, nombreArchivo, onCerrar }) {
  const lienzo = useRef(null);
  const visor = useRef(null);
  const siguiente = useRef(null);
  const anterior = useRef(null);
  const [total, setTotal] = useState(0);
  const [actual, setActual] = useState(0);
  const [estado, setEstado] = useState("cargando");
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });

  // Carga y dibuja la primera diapositiva entera en el espacio disponible.
  // La proporción (16:9, 4:3…) es la de cada presentación: se dibuja una vez
  // al ancho, se mide y, si no cabe de alto, se vuelve a dibujar más angosta.
  useEffect(() => {
    let vigente = true;
    async function cargar() {
      try {
        const { init } = await import("pptx-preview");
        const contenedor = lienzo.current;
        const cuerpo = contenedor?.parentElement;
        if (!vigente || !contenedor || !cuerpo) return;
        const datos = await blob.arrayBuffer();
        const dibujar = async (ancho, proporcion) => {
          contenedor.replaceChildren();
          const previsor = init(contenedor, {
            width: ancho,
            height: Math.round(ancho * proporcion),
            mode: "slide",
          });
          await previsor.load(datos);
          previsor.renderSingleSlide(0);
          return previsor;
        };
        const disponibleAncho = Math.max(280, cuerpo.clientWidth - 32);
        // Menos el pie con «Anterior / Siguiente», que aparece al terminar.
        const disponibleAlto = Math.max(200, cuerpo.clientHeight - 32 - 58);
        let ancho = Math.min(1100, disponibleAncho);
        let previsor = await dibujar(ancho, 9 / 16);
        const diapositiva = contenedor.querySelector(
          ".pptx-preview-slide-wrapper",
        );
        const proporcion = diapositiva?.offsetWidth
          ? diapositiva.offsetHeight / diapositiva.offsetWidth
          : 9 / 16;
        const ajustado = Math.min(
          ancho,
          Math.floor(disponibleAlto / proporcion),
        );
        if (vigente && (ajustado !== ancho || proporcion !== 9 / 16)) {
          previsor.destroy?.();
          ancho = ajustado;
          previsor = await dibujar(ancho, proporcion);
        }
        if (!vigente) {
          previsor.destroy?.();
          return;
        }
        visor.current = previsor;
        setTotal(previsor.slideCount);
        setActual(0);
        setEstado("lista");
      } catch {
        if (vigente) setEstado("error");
      }
    }
    cargar();
    return () => {
      vigente = false;
      visor.current?.destroy?.();
      visor.current = null;
    };
  }, [blob]);

  const ir = useCallback(
    (indice) => {
      const previsor = visor.current;
      if (!previsor || indice < 0 || indice >= total) return;
      previsor.removeCurrentSlide?.();
      previsor.renderSingleSlide(indice);
      setActual(indice);
      // En los extremos el botón con el foco se desactiva: el foco pasa al
      // otro para no perderse (auditoría UX/UI, 30/10/2026).
      const activo = document.activeElement;
      if (indice === total - 1 && activo === siguiente.current)
        anterior.current?.focus();
      else if (indice === 0 && activo === anterior.current)
        siguiente.current?.focus();
    },
    [total],
  );

  // Al terminar de cargar, el foco va a «Siguiente».
  useEffect(() => {
    if (estado === "lista") siguiente.current?.focus();
  }, [estado]);

  // Las flechas del teclado (y Re Pág / Av Pág) pasan las diapositivas.
  useEffect(() => {
    function teclas(evento) {
      if (estado !== "lista") return;
      if (evento.key === "ArrowRight" || evento.key === "PageDown") {
        evento.preventDefault();
        ir(actual + 1);
      } else if (evento.key === "ArrowLeft" || evento.key === "PageUp") {
        evento.preventDefault();
        ir(actual - 1);
      } else if (evento.key === "Home") {
        evento.preventDefault();
        ir(0);
      } else if (evento.key === "End") {
        evento.preventDefault();
        ir(total - 1);
      }
    }
    document.addEventListener("keydown", teclas);
    return () => document.removeEventListener("keydown", teclas);
  }, [estado, actual, total, ir]);

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="visor-pdf visor-presentacion"
        role="dialog"
        aria-modal="true"
        aria-labelledby="visor-ppt-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="visor-pdf__cabecera">
          <Icon
            name="file-earmark-slides"
            className="visor-presentacion__icono"
          />
          <h3 id="visor-ppt-titulo">{titulo}</h3>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => descargarBlob(blob, nombreArchivo)}
          >
            <Icon name="download" /> Descargar
          </button>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar visor"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="visor-pdf__cuerpo visor-presentacion__cuerpo">
          {estado === "cargando" && (
            <p className="mz-faint" role="status">
              Cargando la presentación…
            </p>
          )}
          {estado === "error" && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              <span>
                No se pudo mostrar la presentación aquí. Puede descargarla para
                verla en PowerPoint.
              </span>
            </div>
          )}
          <div
            ref={lienzo}
            className="visor-presentacion__lienzo"
            role="img"
            aria-label={
              estado === "lista"
                ? `Diapositiva ${actual + 1} de ${total} de «${titulo}»`
                : undefined
            }
            aria-hidden={estado !== "lista" ? true : undefined}
          />
        </div>
        {estado === "lista" && (
          <div className="visor-presentacion__pie">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={actual === 0}
              onClick={() => ir(actual - 1)}
              ref={anterior}
            >
              <Icon name="chevron-left" /> Anterior
            </button>
            <span className="visor-presentacion__contador" aria-live="polite">
              Diapositiva <strong>{actual + 1}</strong> de {total}
            </span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={actual >= total - 1}
              onClick={() => ir(actual + 1)}
              ref={siguiente}
            >
              Siguiente <Icon name="chevron-right" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
