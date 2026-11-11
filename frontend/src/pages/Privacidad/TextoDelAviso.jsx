import { enUnaLinea, esDeUnaLinea } from "./privacidadComunes";

/**
 * El texto del aviso de privacidad, en párrafos y listas. Se escribe como
 * texto simple: una línea en blanco separa párrafos y las líneas que empiezan
 * con «- » forman una lista. Nada se interpreta como HTML (React escapa todo),
 * así que no hace falta sanear: en Nexo era Markdown con DOMPurify.
 *
 * Desde US-004 (11/11/2026) todos los textos de protección de datos se
 * muestran con este componente, el mismo de la vista previa de «Textos»: lo
 * que se previsualiza es lo que se ve. `resaltar` pone en negrita una frase
 * (los «N días» del plazo en «Mis derechos»).
 */
export function bloquesDelAviso(texto) {
  return String(texto || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((bloque) => bloque.trim())
    .filter(Boolean)
    .map((bloque) => {
      const lineas = bloque.split("\n").map((l) => l.trim());
      if (lineas.every((l) => l.startsWith("- "))) {
        return { tipo: "lista", items: lineas.map((l) => l.slice(2).trim()) };
      }
      return { tipo: "parrafo", lineas };
    });
}

function conResaltado(linea, resaltar) {
  if (!resaltar) return linea;
  const i = linea.indexOf(resaltar);
  if (i < 0) return linea;
  return (
    <>
      {linea.slice(0, i)}
      <strong>{resaltar}</strong>
      {linea.slice(i + resaltar.length)}
    </>
  );
}

export function TextoDelAviso({ texto, resaltar, className = "" }) {
  return (
    <div className={`pv-aviso-texto ${className}`.trim()}>
      {bloquesDelAviso(texto).map((bloque, i) =>
        bloque.tipo === "lista" ? (
          <ul key={i}>
            {bloque.items.map((item, j) => (
              <li key={j}>{conResaltado(item, resaltar)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {bloque.lineas.map((linea, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {conResaltado(linea, resaltar)}
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}

/**
 * Un texto del catálogo como lo muestra su pantalla: en una línea si es de una
 * línea (`esDeUnaLinea`), o en párrafos y listas. Lo usan la tarjeta, el
 * historial de versiones y el detalle de una aceptación, para que todos
 * coincidan con la vista previa.
 */
export function TextoDeProteccion({ clave, formato, texto, className = "" }) {
  if (esDeUnaLinea({ clave, formato })) {
    return (
      <p className={`pv-texto-linea mb-0 ${className}`.trim()}>
        {enUnaLinea(texto)}
      </p>
    );
  }
  return <TextoDelAviso texto={texto} className={className} />;
}
