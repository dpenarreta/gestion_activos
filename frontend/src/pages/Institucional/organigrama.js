/**
 * Arma el árbol del organigrama a partir de la respuesta plana del servidor:
 * cada unidad con su nivel, sus cargos (ordenados de jefe a subordinado) y sus
 * unidades hijas.
 */
export function armarArbol({ niveles = [], unidades = [], cargos = [] }) {
  const nivelPorId = new Map(niveles.map((n) => [n.id, n]));
  const nodos = new Map(
    unidades.map((u) => [
      u.id,
      { ...u, nivel: nivelPorId.get(u.nivel) ?? null, cargos: [], hijas: [] },
    ]),
  );
  for (const cargo of cargos) {
    nodos.get(cargo.unidad)?.cargos.push(cargo);
  }
  const raices = [];
  for (const nodo of nodos.values()) {
    nodo.cargos = ordenarPorJefe(nodo.cargos);
    const padre = nodo.padre ? nodos.get(nodo.padre) : null;
    if (padre) padre.hijas.push(nodo);
    else raices.push(nodo);
  }
  return raices;
}

/**
 * Los cargos de una unidad como árbol por niveles: arriba quien no reporta a
 * nadie de la unidad (el gerente del área) y debajo, en cada uno, los que le
 * reportan. Devuelve las raíces, cada una con `hijos`, `informan` y su
 * `profundidad`.
 *
 * Los que informan sin supervisión directa (19/11/2026, el Comité Ejecutivo
 * del Directorio): un cargo sin jefe directo en la unidad que reporta en
 * línea punteada a cargos de ella va **debajo** de ellos, en `informan`. Si
 * informa a varios que comparten jefe (los dos Directores), cuelga de ese
 * jefe en una fila aparte, que se dibuja bajo la de ellos. Con `todos`, se
 * suman como tarjeta de referencia los que encabezan otra unidad e informan
 * a esta (el Gerente General): `cargo.externo`.
 */
export function arbolDeCargos(cargos, todos = cargos) {
  const ids = new Set(cargos.map((c) => c.id));
  const porId = new Map(cargos.map((c) => [c.id, c]));
  const hijos = new Map();
  const informan = new Map();
  const agregar = (mapa, clave, cargo) => {
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(cargo);
  };
  const jefeEnLaUnidad = (c) => (c.jefe && ids.has(c.jefe) ? c.jefe : null);
  const externos = todos
    .filter(
      (c) =>
        !ids.has(c.id) &&
        !c.jefe &&
        (c.jefes_secundarios ?? []).some((id) => ids.has(id)),
    )
    .map((c) => ({ ...c, externo: true }));
  for (const c of [...cargos, ...externos]) {
    const directo = jefeEnLaUnidad(c);
    const punteados = directo
      ? []
      : (c.jefes_secundarios ?? []).filter((id) => ids.has(id));
    if (directo || punteados.length === 0) {
      if (!c.externo) agregar(hijos, directo, c);
      continue;
    }
    const comunes = new Set(
      punteados.map((id) => jefeEnLaUnidad(porId.get(id))),
    );
    const comun = comunes.size === 1 ? [...comunes][0] : null;
    agregar(informan, punteados.length > 1 && comun ? comun : punteados[0], c);
  }
  const porNombre = (a, b) => a.nombre.localeCompare(b.nombre);
  const armar = (lista, profundidad, vistos) =>
    lista
      .filter((c) => !vistos.has(c.id))
      .sort(porNombre)
      .map((c) => {
        const visto = new Set([...vistos, c.id]);
        const debajo = hijos.get(c.id) ?? [];
        return {
          cargo: c,
          profundidad,
          hijos: armar(debajo, profundidad + 1, visto),
          // Bajo la fila de sus hijos cuando informan a ellos; si no, justo
          // debajo de él.
          informan: armar(
            informan.get(c.id) ?? [],
            profundidad + (debajo.length ? 2 : 1),
            visto,
          ),
        };
      });
  return armar(hijos.get(null) ?? [], 0, new Set());
}

/** Dentro de una unidad, primero quien no reporta a nadie de ella. */
function ordenarPorJefe(cargos) {
  const ids = new Set(cargos.map((c) => c.id));
  const profundidad = new Map();
  const nivelDe = (cargo, vistos = new Set()) => {
    if (profundidad.has(cargo.id)) return profundidad.get(cargo.id);
    if (!cargo.jefe || !ids.has(cargo.jefe) || vistos.has(cargo.id)) return 0;
    vistos.add(cargo.id);
    const jefe = cargos.find((c) => c.id === cargo.jefe);
    const valor = nivelDe(jefe, vistos) + 1;
    profundidad.set(cargo.id, valor);
    return valor;
  };
  return [...cargos].sort(
    (a, b) => nivelDe(a) - nivelDe(b) || a.nombre.localeCompare(b.nombre),
  );
}

/** Totales de una rama: plazas, ocupadas y vacantes, contando las hijas. */
export function totalesDe(nodo) {
  const propios = nodo.cargos.reduce(
    (suma, c) => ({
      plazas: suma.plazas + c.plazas,
      vacantes: suma.vacantes + c.vacantes,
    }),
    { plazas: 0, vacantes: 0 },
  );
  return nodo.hijas.map(totalesDe).reduce(
    (suma, t) => ({
      plazas: suma.plazas + t.plazas,
      vacantes: suma.vacantes + t.vacantes,
    }),
    propios,
  );
}

/**
 * «Gerente de TI · Gerencia de TI». Si en la unidad hay otro cargo con el
 * mismo nombre (bajo otro jefe), se dice también a quién reporta.
 */
export function nombreDeCargo(cargo, unidades, cargos = []) {
  if (!cargo) return "";
  const unidad = unidades.find((u) => u.id === cargo.unidad);
  if (!unidad) return cargo.nombre;
  let texto = `${cargo.nombre} · ${unidad.nombre}`;
  const gemelo = cargos.some(
    (c) =>
      c.id !== cargo.id &&
      c.unidad === cargo.unidad &&
      c.nombre.toLowerCase() === cargo.nombre.toLowerCase(),
  );
  const jefe = cargos.find((c) => c.id === cargo.jefe);
  if (gemelo && jefe) texto += ` (reporta a ${jefe.nombre})`;
  return texto;
}
