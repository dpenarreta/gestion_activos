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
