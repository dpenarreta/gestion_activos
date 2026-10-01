/**
 * Traduce los filtros vigentes del inventario a frases que se puedan leer.
 *
 * Existe para los «chips» del listado: con nueve desplegables, mirar cuál
 * quedó en algo distinto de «todos» obliga a repasarlos uno a uno, y es la
 * causa más común de «el inventario no me muestra un equipo que sé que está».
 * Cada chip dice qué se está aplicando y se puede quitar por separado.
 *
 * Las etiquetas se construyen aquí y no en el componente porque las de los
 * catálogos —tipo, área, sede— hay que buscarlas en listas que llegan del
 * servidor, y mezclar eso con el JSX de la tabla lo volvía ilegible.
 */

const ETIQUETAS_FIJAS = {
  estado: {
    disponible: "Disponible",
    en_uso: "Asignado",
    en_bodega: "En bodega",
    en_mantenimiento: "En reparación",
    en_garantia: "En reclamación de garantía",
    en_transito: "En tránsito",
    dado_de_baja: "Dado de baja",
    perdido: "Perdido",
    robado: "Robado",
  },
  criticidad: {
    critica: "Crítica",
    alta: "Alta",
    media: "Media",
    baja: "Baja",
  },
  uso: {
    administrativo: "Administrativo",
    operativo: "Operativo",
    desarrollo: "Desarrollo",
    diseno: "Diseño",
    gerencial: "Gerencial",
    atencion_cliente: "Atención al cliente",
    bodega: "Bodega",
    infraestructura: "Infraestructura",
  },
  propiedad: {
    propia: "De la empresa",
    concesion: "En concesión",
  },
  garantia: {
    vigente: "En garantía",
    por_vencer: "Por vencer",
    vencida: "Vencida",
    sin_registrar: "Sin registrar",
  },
  nivel_renovacion: {
    recomendado: "Reemplazo recomendado",
    evaluar: "Evaluar reemplazo",
    ninguno: "Sin sugerencia",
  },
  almacenados: { true: "En almacén" },
  compartido: { true: "Compartidos", false: "De un solo responsable" },
  requiere_renovacion: { true: "Requieren renovación" },
  operativos: { false: "Fuera del parque" },
};

const TITULOS = {
  q: "Búsqueda",
  tipo: "Tipo",
  departamento: "Área",
  sede: "Sede",
  estado: "Estado",
  criticidad: "Criticidad",
  uso: "Uso",
  propiedad: "Propiedad",
  concesionario: "Concesionario",
  garantia: "Garantía",
  nivel_renovacion: "Renovación",
  antiguedad: "Antigüedad",
  custodio: "Custodio",
  almacenados: "Ubicación",
  compartido: "Responsables",
  requiere_renovacion: "Renovación",
  operativos: "Parque",
};

const ANTIGUEDADES = {
  "0-12": "Menos de 1 año",
  "12-36": "Entre 1 y 3 años",
  "36-60": "Entre 3 y 5 años",
  "60-": "Más de 5 años",
};

function nombreDeCatalogo(lista, id) {
  const encontrado = (lista || []).find(
    (item) => String(item.id) === String(id),
  );
  return encontrado?.nombre || `#${id}`;
}

/**
 * @param filtros  los valores vigentes del listado
 * @param catalogos  { tipos, departamentos, sedes } tal como los cargó la pantalla
 * @returns [{ claves, titulo, texto }] — `claves` son los filtros que hay que
 *          vaciar para quitar ese chip (la antigüedad son dos).
 */
export function describirFiltros(filtros, catalogos = {}) {
  const chips = [];
  const añadir = (claves, clave, texto) =>
    chips.push({ claves, titulo: TITULOS[clave] || clave, texto });

  if (filtros.q) añadir(["q"], "q", `«${filtros.q}»`);
  if (filtros.tipo)
    añadir(["tipo"], "tipo", nombreDeCatalogo(catalogos.tipos, filtros.tipo));
  if (filtros.departamento)
    añadir(
      ["departamento"],
      "departamento",
      nombreDeCatalogo(catalogos.departamentos, filtros.departamento),
    );
  if (filtros.sede)
    añadir(["sede"], "sede", nombreDeCatalogo(catalogos.sedes, filtros.sede));

  for (const clave of [
    "estado",
    "criticidad",
    "uso",
    "propiedad",
    "garantia",
    "nivel_renovacion",
    "almacenados",
    "compartido",
    "requiere_renovacion",
    "operativos",
  ]) {
    const valor = filtros[clave];
    if (!valor) continue;
    const texto = ETIQUETAS_FIJAS[clave]?.[valor];
    // Un valor que no está en la tabla igual se muestra, con su valor crudo:
    // esconderlo dejaría el listado filtrado por algo invisible.
    if (texto !== undefined) añadir([clave], clave, texto);
    else añadir([clave], clave, String(valor));
  }

  // La antigüedad viaja como dos campos pero es una sola decisión: se muestra
  // como un chip y se quita entero.
  const { antiguedad_min_meses: desde, antiguedad_max_meses: hasta } = filtros;
  if (desde || hasta) {
    const rango = `${desde || ""}-${hasta || ""}`;
    añadir(
      ["antiguedad_min_meses", "antiguedad_max_meses"],
      "antiguedad",
      ANTIGUEDADES[rango] || `${desde || "0"} a ${hasta || "∞"} meses`,
    );
  }

  if (filtros.custodio)
    añadir(["custodio"], "custodio", `#${filtros.custodio}`);
  if (filtros.concesionario)
    añadir(["concesionario"], "concesionario", `#${filtros.concesionario}`);

  return chips;
}
