import { useCallback, useEffect, useRef, useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";

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

/**
 * Trae las imágenes como blobs (no tienen URL pública) y devuelve sus
 * direcciones `blob:` locales, que se liberan al desmontar.
 */
export function useImagenesDeNoticias(noticias) {
  const [urls, setUrls] = useState({});
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
            const url = URL.createObjectURL(blob);
            creadas.push(url);
            setUrls((actual) => ({ ...actual, [id]: url }));
          })
          .catch(() => null);
      });
    return () => {
      vigente = false;
      creadas.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [clave]);

  return urls;
}

/**
 * El carrusel de noticias de Inicio: una imagen a la vez, que cambia sola cada
 * `segundos`, con botones de anterior y siguiente y un punto por imagen.
 *
 * Se detiene mientras el mouse o el foco están encima (para poder leer), y se
 * maneja con las flechas del teclado.
 */
export function CarruselNoticias({ noticias, segundos = 6 }) {
  const [actual, setActual] = useState(0);
  const [pausado, setPausado] = useState(false);
  const urls = useImagenesDeNoticias(noticias);
  const total = noticias.length;
  const marco = useRef(null);

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
      Math.max(2, segundos) * 1000,
    );
    return () => clearInterval(reloj);
  }, [pausado, total, segundos]);

  if (total === 0) return null;
  const noticia = noticias[Math.min(actual, total - 1)];

  return (
    // Patrón de carrusel de WAI-ARIA: la región se detiene con el mouse o el
    // foco encima y las flechas del teclado cambian de imagen; los controles
    // de verdad son los botones de dentro.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={marco}
      className="carrusel"
      aria-roledescription="carrusel"
      aria-label="Noticias y eventos"
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={(e) => {
        if (!marco.current?.contains(e.relatedTarget)) setPausado(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") ir(actual - 1);
        if (e.key === "ArrowRight") ir(actual + 1);
      }}
    >
      <div
        className="carrusel__diapositiva"
        role="group"
        aria-roledescription="diapositiva"
        aria-label={`${actual + 1} de ${total}${noticia.titulo ? `: ${noticia.titulo}` : ""}`}
      >
        {urls[noticia.id] ? (
          <img
            src={urls[noticia.id]}
            alt={noticia.titulo || noticia.descripcion || "Noticia"}
          />
        ) : (
          <div className="carrusel__cargando" aria-hidden="true">
            <Icon name="image" />
          </div>
        )}
        {(noticia.titulo || noticia.descripcion) && (
          <div className="carrusel__texto">
            {noticia.titulo && <strong>{noticia.titulo}</strong>}
            {noticia.descripcion && <span>{noticia.descripcion}</span>}
          </div>
        )}
      </div>

      {total > 1 && (
        <>
          <button
            type="button"
            className="carrusel__flecha carrusel__flecha--anterior"
            aria-label="Imagen anterior"
            onClick={() => ir(actual - 1)}
          >
            <Icon name="chevron-left" />
          </button>
          <button
            type="button"
            className="carrusel__flecha carrusel__flecha--siguiente"
            aria-label="Imagen siguiente"
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
                aria-label={`Ir a la imagen ${i + 1}`}
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
