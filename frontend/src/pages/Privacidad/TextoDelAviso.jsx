/**
 * El texto del aviso de privacidad, en párrafos y listas. Se escribe como
 * texto simple: una línea en blanco separa párrafos y las líneas que empiezan
 * con «- » forman una lista. Nada se interpreta como HTML (React escapa todo),
 * así que no hace falta sanear: en Nexo era Markdown con DOMPurify.
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

export function TextoDelAviso({ texto }) {
  return (
    <div className="pv-aviso-texto">
      {bloquesDelAviso(texto).map((bloque, i) =>
        bloque.tipo === "lista" ? (
          <ul key={i}>
            {bloque.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            {bloque.lineas.map((linea, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {linea}
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
