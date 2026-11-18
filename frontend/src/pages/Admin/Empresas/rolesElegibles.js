/**
 * Los roles que se pueden elegir a mano, en orden alfabético.
 *
 * Se quitan los de cargo del organigrama (`rol.cargo`): esos los pone el cargo
 * que ocupa la persona y el servidor descarta los que se envíen a mano
 * (`organizacion.roles_de_cargo.ajustar_membresia`). Ofrecerlos en un
 * desplegable era ofrecer una opción que se perdía en silencio al guardar, y
 * además eran la mayoría del catálogo: el rol buscado quedaba enterrado entre
 * un centenar de cargos.
 *
 * El orden es el del alfabeto español (tildes y eñes en su sitio) y no el del
 * catálogo, que sale por fecha de creación y no ayuda a encontrar nada.
 */
export function rolesElegibles(catalogo) {
  return (catalogo ?? [])
    .filter((rol) => !rol.cargo)
    .sort((a, b) =>
      a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
    );
}

/**
 * Los roles de los cargos del organigrama, en orden alfabético (18/11/2026,
 * pedido del usuario: un cargo y su rol son lo mismo). Se eligen en los
 * desplegables de roles como cualquier otro (`OpcionesDeRolesDeCargo`), y
 * elegir uno ubica a la persona en ese cargo.
 */
export function rolesDeCargo(catalogo) {
  return (catalogo ?? [])
    .filter((rol) => rol.cargo)
    .sort((a, b) =>
      a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
    );
}

/** El texto de cada rol de cargo en un desplegable. */
export const TEXTO_ROL_DE_CARGO = "la ubica en el cargo";
