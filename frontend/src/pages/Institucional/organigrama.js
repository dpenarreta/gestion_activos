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
