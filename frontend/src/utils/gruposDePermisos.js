/**
 * El catálogo de permisos, agrupado por la parte del sistema a la que
 * pertenece cada bloque: los generales (valen en todo el sistema) y los de
 * cada módulo. El servidor manda el grupo dentro de cada bloque
 * (`backend/apps/permissions/catalog.py`, `MODULE_GROUPS`); un bloque sin
 * grupo —un catálogo viejo en caché, por ejemplo— cae en «Otros».
 *
 * Devuelve `[{ id, label, alcance, description, modulos: [[clave, bloque]] }]`
 * en el orden de los grupos.
 */
export function agruparCatalogo(catalog) {
  const grupos = new Map();
  for (const [clave, modulo] of Object.entries(catalog || {})) {
    const grupo = modulo.grupo ?? {
      id: "otros",
      label: "Otros",
      alcance: "modulo",
      description: "",
      orden: Number.MAX_SAFE_INTEGER,
    };
    if (!grupos.has(grupo.id)) grupos.set(grupo.id, { ...grupo, modulos: [] });
    grupos.get(grupo.id).modulos.push([clave, modulo]);
  }
  return [...grupos.values()].sort((a, b) => a.orden - b.orden);
}

/** Los códigos de todos los permisos de un grupo. */
export function codigosDelGrupo(grupo) {
  return grupo.modulos.flatMap(([, modulo]) => Object.keys(modulo.permissions));
}
