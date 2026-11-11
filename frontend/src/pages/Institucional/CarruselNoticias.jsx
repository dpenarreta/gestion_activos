import { useCallback, useEffect, useRef, useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { blobDeImagen } from "../../utils/blobs";

/**
 * Las medidas recomendadas para las imágenes del carrusel. En Inicio ocupa la
 * mitad del ancho y su marco es siempre 16:10 (es el que fija el alto de la
 * fila; el calendario se ajusta a él). El 16:10 es el marco, no una exigencia
 * (US-007, 11/11/2026): cada imagen se muestra completa (`contain`) y el
 * espacio que sobra se rellena con ella misma desenfocada, así que una
 * vertical (1000 × 1600, un afiche) también se ve entera, sin recortes. Una
 * horizontal de esta medida es la que llena el marco.
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
 * La parte de abajo del marco que pueden tapar los puntos y la franja del
 * título en escritorio. Se publica el peor caso (título y descripción de 2
 * líneas cada uno, con relleno de 20 px arriba y 30 px abajo: ~38 % del
 * alto), para que «Medidas» diga la verdad con cualquier texto. La misma
 * cifra vale para horizontales y verticales, porque la franja cruza el marco
 * entero (revisión UX de US-007, 11/11/2026).
 */
export const ZONA_INFERIOR = 0.4;

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

/**
 * La imagen completa (`object-fit: contain`) sobre ella misma desenfocada y
 * oscurecida, para que una vertical o de otra proporción no deje bandas vacías
 * ni se recorte (US-007, 11/11/2026). El fondo es decorativo: `aria-hidden` y
 * como `background-image`, para que la única imagen que se anuncia sea la de
 * delante, con su texto alternativo. Se usa en el carrusel y en la vista
 * previa del formulario, para que esta muestre lo mismo que se verá.
 */
export function ImagenConFondo({ src, alt }) {
  // En `url()` solo entran direcciones `blob:` creadas aquí (las imágenes no
  // tienen URL pública): otra cosa podría cerrar las comillas e inyectar CSS.
  // Sin una válida, queda el color de respaldo del fondo.
  const fondo =
    typeof src === "string" && /^blob:[^"\\\s()]+$/.test(src)
      ? { backgroundImage: `url("${src}")` }
      : undefined;
  return (
    <>
      <div className="carrusel__fondo" aria-hidden="true" style={fondo} />
      <img className="carrusel__imagen" src={src} alt={alt} />
    </>
  );
}

/** La franja con el título y la descripción, igual en el carrusel y en la
 * vista previa del formulario. Sin ninguno de los dos, no se pinta. */
export function TextoDeDiapositiva({ titulo, descripcion }) {
  if (!titulo && !descripcion) return null;
  return (
    <div className="carrusel__texto">
      {titulo && <strong>{titulo}</strong>}
      {descripcion && <span>{descripcion}</span>}
    </div>
  );
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
          {/* La imagen va en su propio marco y la franja del título es su
              hermana: en escritorio la franja va encima del marco; en el
              teléfono, debajo, y el marco 16:10 queda entero para la imagen
              (revisión UX de US-007). */}
          <div className="carrusel__medio">
            {url ? (
              // Sin texto alternativo, la imagen es decorativa: el título y la
              // descripción de la franja dicen lo importante.
              <ImagenConFondo src={url} alt={noticia.texto_alternativo || ""} />
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
          </div>
          <TextoDeDiapositiva
            titulo={noticia.titulo}
            descripcion={noticia.descripcion}
          />
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
