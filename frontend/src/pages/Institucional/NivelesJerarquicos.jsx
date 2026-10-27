import { NivelDeCargo } from "./NivelDeCargo";

const VISIBLES = 10;

/** Los nombres de los cargos de un nivel, como chips; un nombre que se repite
 * en varias unidades lleva «×N» para que la suma cuadre con el total. */
function NombresDeCargos({ cargos }) {
  const veces = new Map();
  for (const c of cargos) veces.set(c.nombre, (veces.get(c.nombre) ?? 0) + 1);
  const nombres = [...veces.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (!nombres.length) return <span className="mz-faint">—</span>;
  const chip = ([nombre, n]) => (
    <li key={nombre} className="niveles-cargo__chip">
      {nombre}
      {n > 1 && <span className="niveles-cargo__veces"> ×{n}</span>}
    </li>
  );
  return (
    <>
      <ul className="niveles-cargo__chips">
        {nombres.slice(0, VISIBLES).map(chip)}
      </ul>
      {nombres.length > VISIBLES && (
        <details className="niveles-cargo__mas">
          <summary>y {nombres.length - VISIBLES} más</summary>
          <ul className="niveles-cargo__chips">
            {nombres.slice(VISIBLES).map(chip)}
          </ul>
        </details>
      )}
    </>
  );
}

/**
 * Estructura → «Niveles jerárquicos» (27/10/2026): los seis niveles de los
 * cargos, de arriba hacia abajo, con cuántos cargos activos hay en cada uno y
 * cuáles son. Son fijos para toda la empresa; el nivel de cada cargo se
 * elige en la pestaña «Cargos».
 */
export function NivelesJerarquicos({ datos }) {
  const activos = datos.cargos.filter((c) => c.activo !== false);
  return (
    <section className="mz-card" aria-labelledby="niveles-cargo-titulo">
      <div className="mz-card-body mz-stack">
        <div>
          <h3 id="niveles-cargo-titulo" className="inicio-titulo mb-1">
            Niveles jerárquicos de los cargos
          </h3>
          <p className="estructura-desc mb-0">
            Cuántos cargos activos hay en cada nivel. El nivel de cada cargo se
            elige en la pestaña «Cargos», y un cargo no puede reportar a otro de
            un nivel más bajo.
          </p>
        </div>
        <div className="mz-table-wrap">
          <table className="mz-table niveles-cargo">
            <thead>
              <tr>
                <th className="num">Orden</th>
                <th>Nivel</th>
                <th className="num">Cargos activos</th>
                <th>Cuáles</th>
              </tr>
            </thead>
            <tbody>
              {(datos.niveles_cargo ?? []).map((nivel) => {
                const delNivel = activos.filter((c) => c.nivel === nivel.valor);
                return (
                  <tr key={nivel.valor}>
                    <td className="num">{nivel.orden + 1}</td>
                    <td>
                      <NivelDeCargo valor={nivel.valor} datos={datos} />
                    </td>
                    <td className="num">{delNivel.length}</td>
                    <td>
                      <NombresDeCargos cargos={delNivel} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
