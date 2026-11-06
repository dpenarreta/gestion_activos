import { useEffect, useState } from "react";

/** Cuánto tiene que quedar quieto el resultado antes de anunciarlo. */
const PAUSA_MS = 600;

/*
 * Cuántos resultados dejó la búsqueda, para los lectores de pantalla
 * (búsqueda en vivo, 06/11/2026).
 *
 * Con el filtrado en cada tecla, la tabla cambia sin que el foco se mueva del
 * campo: quien no ve la pantalla no se entera. Esta región viva lo dice —«12
 * resultados», «Sin resultados para «zzz»»— cuando el resultado lleva un
 * momento quieto, no en cada letra (que haría hablar al lector sin parar), y
 * no mientras la consulta está en camino.
 *
 * Va siempre montada: una región viva que aparece junto con su texto no se
 * anuncia en varios lectores. Sin término no dice nada: la lista entera no es
 * el resultado de una búsqueda.
 *
 * @param {object} props
 * @param {string} props.termino lo buscado (vacío: no se anuncia)
 * @param {number} props.total cuántos se ven
 * @param {number} [props.de] cuántos hay en total, si se ven menos (las
 *   sugerencias de la barra muestran 6 de 12)
 * @param {[string, string]} [props.sustantivo] singular y plural
 * @param {boolean} [props.restoEnVerTodos] si hay más, decir que «Ver
 *   todos» los trae
 * @param {boolean} [props.cargando] la consulta todavía no llegó
 */
export function AnuncioDeResultados({
  termino,
  total,
  de,
  sustantivo = ["resultado", "resultados"],
  restoEnVerTodos = false,
  cargando = false,
}) {
  const [anuncio, setAnuncio] = useState("");
  const buscado = (termino ?? "").trim();
  const [singular, plural] = sustantivo;

  useEffect(() => {
    if (!buscado) {
      setAnuncio("");
      return undefined;
    }
    if (cargando) return undefined;
    let texto;
    if (total === 0) {
      // Con las comillas de la pantalla (auditoría UX/UI, 06/11/2026).
      texto = `Sin ${plural} para «${buscado}»`;
    } else {
      texto = `${total} ${total === 1 ? singular : plural}`;
      if (de > total) {
        texto += ` de ${de}`;
        if (restoEnVerTodos) texto += "; «Ver todos» para el resto";
      }
    }
    const espera = setTimeout(() => setAnuncio(texto), PAUSA_MS);
    return () => clearTimeout(espera);
  }, [buscado, total, de, singular, plural, restoEnVerTodos, cargando]);

  return (
    <p className="visually-hidden" role="status" aria-live="polite">
      {anuncio}
    </p>
  );
}
