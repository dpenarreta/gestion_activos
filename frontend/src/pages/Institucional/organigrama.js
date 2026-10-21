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
 * reportan. Devuelve las raíces, cada una con `hijos` y su `profundidad`.
 */
export function arbolDeCargos(cargos) {
  const ids = new Set(cargos.map((c) => c.id));
  const hijos = new Map();
  for (const c of cargos) {
    const padre = c.jefe && ids.has(c.jefe) ? c.jefe : null;
    if (!hijos.has(padre)) hijos.set(padre, []);
    hijos.get(padre).push(c);
  }
  const armar = (padre, profundidad, vistos) =>
    (hijos.get(padre) ?? [])
      .filter((c) => !vistos.has(c.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((c) => ({
        cargo: c,
        profundidad,
        hijos: armar(c.id, profundidad + 1, new Set([...vistos, c.id])),
      }));
  return armar(null, 0, new Set());
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
