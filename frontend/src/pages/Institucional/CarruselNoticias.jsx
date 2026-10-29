import { useCallback, useEffect, useRef, useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { blobDeImagen } from "../../utils/blobs";

/**
 * La medida en que se deben hacer las imágenes del carrusel. En Inicio ocupa
 * la mitad del ancho y siempre 16:10 (es el que fija el alto de la fila; el
 * calendario se ajusta a él), así que una imagen de esta medida se ve
 * completa en cualquier pantalla.
 */
export const MEDIDAS_CARRUSEL = {
  ancho: 1600,
  alto: 1000,
  proporcion: "16:10",
  minimoAncho: 1200,
  minimoAlto: 750,
};

/** Lo mínimo que se deja una noticia antes de pasar a la siguiente: menos
 * no alcanza para leerla (auditoría UX/UI, 27/10/2026). */
export const SEGUNDOS_MINIMOS = 5;

/**
 * Trae las imágenes como blobs (no tienen URL pública) y devuelve sus
 * direcciones `blob:` locales (`urls`, que se liberan al desmontar) y las que
 * no se pudieron traer (`fallidas`, para no dejar el «cargando» para
 * siempre).
 */
export function useImagenesDeNoticias(noticias) {
  const [urls, setUrls] = useState({});
  const [fallidas, setFallidas] = useState({});
  const clave = noticias.map((n) => n.id).join(",");

  useEffect(() => {
    let vigente = true;
    const creadas = [];
    clave
      .split(",")
      .filter(Boolean)
      .forEach((id) => {
        institucionalService
          .imagenNoticia(id)
          .then((blob) => {
            if (!vigente) return;
            // Solo con un tipo de imagen de la lista (auditoría de seguridad,
            // 29/10/2026): si no, cuenta como imagen que no se pudo traer.
            const imagen = blobDeImagen(blob);
            if (!imagen)
              throw new Error("La imagen de la noticia no es válida.");
            const url = URL.createObjectURL(imagen);
            creadas.push(url);
            setUrls((actual) => ({ ...actual, [id]: url }));
          })
          .catch(() => {
            if (vigente) setFallidas((actual) => ({ ...actual, [id]: true }));
          });
      });
    return () => {
      vigente = false;
      creadas.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [clave]);

  return { urls, fallidas };
}

/** Si la persona pidió menos movimiento en su sistema. */
function prefiereMenosMovimiento() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
  );
}

/**
 * El carrusel de noticias de Inicio: una imagen a la vez, que cambia sola cada
 * `segundos` (5 como mínimo), con anterior y siguiente, un punto por imagen y
 * un botón para pausarlo (patrón de carrusel de WAI-ARIA).
 *
 * También se detiene mientras el mouse o el foco están encima, y no avanza
 * solo si la persona pidió menos movimiento en su sistema.
 */
export function CarruselNoticias({ noticias, segundos = 6 }) {
  const [actual, setActual] = useState(0);
  const [encima, setEncima] = useState(false);
  const [detenido, setDetenido] = useState(prefiereMenosMovimiento);
  const { urls, fallidas } = useImagenesDeNoticias(noticias);
  const total = noticias.length;
  const marco = useRef(null);
  const pausado = detenido || encima;

  const ir = useCallback(
    (indice) => setActual(((indice % total) + total) % total),
    [total],
  );

  useEffect(() => {
    if (actual >= total) setActual(0);
  }, [actual, total]);

  useEffect(() => {
    if (pausado || total < 2) return undefined;
    const reloj = setInterval(
      () => setActual((i) => (i + 1) % total),
      Math.max(SEGUNDOS_MINIMOS, segundos) * 1000,
    );
    return () => clearInterval(reloj);
  }, [pausado, total, segundos]);

  if (total === 0) return null;
  const noticia = noticias[Math.min(actual, total - 1)];
  const url = urls[noticia.id];
  const fallo = fallidas[noticia.id];

  return (
    // Patrón de carrusel de WAI-ARIA: la región se detiene con el mouse o el
    // foco encima y las flechas del teclado cambian de imagen; los controles
    // de verdad son los botones de dentro.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={marco}
      className="carrusel"
      aria-roledescription="carrusel"
      aria-label="Noticias"
      onMouseEnter={() => setEncima(true)}
      onMouseLeave={() => setEncima(false)}
      onFocus={() => setEncima(true)}
      onBlur={(e) => {
        if (!marco.current?.contains(e.relatedTarget)) setEncima(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") ir(actual - 1);
        if (e.key === "ArrowRight") ir(actual + 1);
      }}
    >
      {total > 1 && (
        <button
          type="button"
          className="carrusel__pausa"
          aria-label={detenido ? "Reanudar noticias" : "Pausar noticias"}
          onClick={() => setDetenido((d) => !d)}
        >
          <Icon name={detenido ? "play-fill" : "pause-fill"} />
        </button>
      )}
      {/* Detenido, el cambio de noticia se anuncia; rotando solo, no (sería
          ruido cada pocos segundos). */}
      <div className="carrusel__marco" aria-live={pausado ? "polite" : "off"}>
        <div
          className="carrusel__diapositiva"
          role="group"
          aria-roledescription="diapositiva"
          aria-label={`${actual + 1} de ${total}${noticia.titulo ? `: ${noticia.titulo}` : ""}`}
        >
          {url ? (
            // Sin texto alternativo, la imagen es decorativa: el título y la
            // descripción, que se leen debajo, dicen lo importante.
            <img src={url} alt={noticia.texto_alternativo || ""} />
          ) : fallo ? (
            <div className="carrusel__cargando carrusel__cargando--fallo">
              <Icon name="image" />
              <span>Imagen no disponible</span>
              {noticia.texto_alternativo && (
                <small>{noticia.texto_alternativo}</small>
              )}
            </div>
          ) : (
            <div className="carrusel__cargando" role="status">
              <span
                className="spinner-border spinner-border-sm"
                aria-hidden="true"
              />
              <span className="visually-hidden">Cargando imagen…</span>
            </div>
          )}
          {(noticia.titulo || noticia.descripcion) && (
            <div className="carrusel__texto">
              {noticia.titulo && <strong>{noticia.titulo}</strong>}
              {noticia.descripcion && <span>{noticia.descripcion}</span>}
            </div>
          )}
        </div>
      </div>

      {total > 1 && (
        <>
          <button
            type="button"
            className="carrusel__flecha carrusel__flecha--anterior"
            aria-label="Noticia anterior"
            onClick={() => ir(actual - 1)}
          >
            <Icon name="chevron-left" />
          </button>
          <button
            type="button"
            className="carrusel__flecha carrusel__flecha--siguiente"
            aria-label="Noticia siguiente"
            onClick={() => ir(actual + 1)}
          >
            <Icon name="chevron-right" />
          </button>
          <div className="carrusel__puntos">
            {noticias.map((n, i) => (
              <button
                key={n.id}
                type="button"
                className={`carrusel__punto${i === actual ? " is-active" : ""}`}
                aria-label={`Ir a la noticia ${i + 1}${n.titulo ? `: ${n.titulo}` : ""}`}
                aria-current={i === actual ? "true" : undefined}
                onClick={() => ir(i)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
