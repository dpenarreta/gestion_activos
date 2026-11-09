import { useMemo, useState } from "react";

import { coincideBusqueda } from "../../utils/busqueda";
import { nombreDeCargo } from "./organigrama";
import "../Admin/Users/SelectorDeCargo.css";

/** Con cientos de cargos se muestran los primeros y se pide acotar. */
const MAXIMO_VISIBLES = 50;

/**
 * «También reporta a»: el reporte secundario o línea punteada de un cargo
 * (09/11/2026). La Jefa de Cartera reporta al Gerente General y también al
 * Jefe Financiero Administrativo.
 *
 * Patrón de `SelectorDeCargo` (alta de usuarios) en modo de varias
 * elecciones: un buscador que filtra en cada tecla (sin tildes ni
 * mayúsculas), la lista con casillas y, debajo, lo elegido con «Quitar». El
 * número de resultados se anuncia en una región viva siempre montada.
 *
 * No se ofrecen el propio cargo ni su jefe inmediato: el servidor tampoco los
 * acepta (`reportes.py`), igual que un círculo entre las dos líneas.
 *
 * Lo que se quita —con «Quitar», desmarcando o porque pasó a ser el jefe
 * inmediato— se anuncia en la misma región viva: el botón desaparece y, sin
 * aviso, el lector de pantalla no se enteraba (auditoría UX/UI, 09/11/2026).
 */
export function SelectorJefesSecundarios({
  id = "est-jefes-secundarios",
  cargoId,
  jefeId,
  elegidos,
  datos,
  onCambio,
}) {
  const [texto, setTexto] = useState("");
  const idAyuda = `${id}-ayuda`;
  const idLista = `${id}-lista`;
  const etiqueta = (c) => nombreDeCargo(c, datos.unidades, datos.cargos);

  /* Lo quitado se calcula al cambiar lo elegido (no en un efecto): la clave
   * es el contenido, no el arreglo, que el padre crea en cada render. Al
   * pasar a otro cargo no se anuncia nada. */
  const clave = elegidos
    .map(Number)
    .sort((a, b) => a - b)
    .join(",");
  const [previo, setPrevio] = useState({ cargoId, clave });
  const [anuncio, setAnuncio] = useState("");
  if (previo.cargoId !== cargoId || previo.clave !== clave) {
    let texto = "";
    if (previo.cargoId === cargoId) {
      const ahora = new Set(clave ? clave.split(",") : []);
      const quitados = (previo.clave ? previo.clave.split(",") : [])
        .filter((x) => !ahora.has(x))
        .map((x) => datos.cargos.find((c) => String(c.id) === x))
        .filter(Boolean);
      if (quitados.length > 0) {
        const esElJefe =
          quitados.length === 1 &&
          String(quitados[0].id) === String(jefeId ?? "");
        texto = `${quitados.length === 1 ? "Se quitó" : "Se quitaron"} ${quitados.map(etiqueta).join(", ")}${
          esElJefe ? ": ahora es el jefe inmediato" : ""
        }.`;
      }
    }
    setPrevio({ cargoId, clave });
    setAnuncio(texto);
  }

  const candidatos = useMemo(
    () =>
      datos.cargos.filter(
        (c) =>
          String(c.id) !== String(cargoId ?? "") &&
          String(c.id) !== String(jefeId ?? ""),
      ),
    [datos, cargoId, jefeId],
  );
  const encontrados = useMemo(
    () => candidatos.filter((c) => coincideBusqueda(texto, etiqueta(c))),
    // `etiqueta` depende solo de `datos`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidatos, texto],
  );
  const visibles = encontrados.slice(0, MAXIMO_VISIBLES);
  const marcados = new Set(elegidos.map(Number));
  const elegidosCargos = datos.cargos.filter((c) => marcados.has(c.id));

  function alternar(cargo, marcado) {
    onCambio(
      marcado
        ? [...elegidos.map(Number), cargo.id]
        : elegidos.map(Number).filter((x) => x !== cargo.id),
    );
  }

  let estado;
  if (candidatos.length === 0) estado = "No hay otros cargos para elegir.";
  else if (encontrados.length === 0)
    estado = "Ningún cargo coincide con la búsqueda.";
  else if (encontrados.length > MAXIMO_VISIBLES)
    estado = `${encontrados.length} cargos: se muestran los primeros ${MAXIMO_VISIBLES}. Escriba para acotar.`;
  else
    estado = `${encontrados.length} ${encontrados.length === 1 ? "cargo encontrado" : "cargos encontrados"}.`;

  return (
    <fieldset className="ua-cargo" aria-describedby={idAyuda}>
      <legend className="ua-cargo__titulo">También reporta a (opcional)</legend>
      <p id={idAyuda} className="form-text mt-0">
        Línea punteada: quien ocupa esos cargos ve a esta persona y a su equipo.
        Las aprobaciones y los avisos al jefe siguen yendo solo al jefe
        inmediato.
      </p>
      <label htmlFor={id} className="form-label mz-small">
        Buscar cargo
      </label>
      <input
        id={id}
        type="search"
        className="form-control form-control-sm"
        value={texto}
        placeholder="Cargo o unidad, p. ej. Jefe Financiero"
        autoComplete="off"
        aria-controls={idLista}
        onChange={(e) => {
          setTexto(e.target.value);
          setAnuncio("");
        }}
      />
      {/* Siempre montado: el número de resultados se anuncia al escribir, y
          lo que se quita, al quitarlo. */}
      <p className="mz-small mz-faint mb-0 mt-1" role="status">
        {anuncio ? `${anuncio} ${estado}` : estado}
      </p>
      <ul
        id={idLista}
        className="ua-cargo__resultados"
        aria-label="Cargos a los que también reporta"
        hidden={visibles.length === 0}
      >
        {visibles.map((c) => (
          <li key={c.id}>
            <label className="ua-cargo__resultado">
              <input
                type="checkbox"
                className="form-check-input"
                checked={marcados.has(c.id)}
                onChange={(e) => alternar(c, e.target.checked)}
              />
              <span className="ua-cargo__nombre">{etiqueta(c)}</span>
            </label>
          </li>
        ))}
      </ul>
      {elegidosCargos.length > 0 && (
        <ul className="ua-cargo__elegido list-unstyled d-flex flex-wrap gap-2">
          {elegidosCargos.map((c) => (
            <li key={c.id} className="ua-cargo__ficha">
              <span className="ua-cargo__nombre">{etiqueta(c)}</span>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => {
                  alternar(c, false);
                  // El botón desaparece: el foco va al buscador.
                  document.getElementById(id)?.focus();
                }}
              >
                Quitar <span className="visually-hidden">{etiqueta(c)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
