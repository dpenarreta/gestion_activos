import { RUTAS_CONFIGURACION } from "../components/admin/ConfiguracionMarco/seccionesConfiguracion";

/**
 * Los módulos del sistema: cada uno trae su propio menú lateral.
 *
 * El sistema creció de un solo asunto —el inventario— a varios. En vez de
 * apilar todo en un menú interminable, cada módulo muestra solo sus pantallas
 * y se cambia de uno a otro desde el selector de la barra superior, junto al
 * de empresa: los dos dicen *dónde* se está trabajando. Lo general del
 * sistema —Reportes y Configuración, con usuarios, roles y permisos— no es de
 * ningún módulo: aparece en todos, en el bloque «General» del menú.
 *
 * Un módulo se identifica por el prefijo de sus rutas. Las que no son de
 * ninguno (las de Configuración) conservan el módulo desde el que se llegó.
 */
export const MODULOS = [
  {
    id: "activos",
    nombre: "Gestión de Activos",
    descripcion: "Inventario, mantenimientos, solicitudes y renovación",
    icono: "pc-display",
    // `/admin` reparte a la primera pantalla que la persona puede abrir.
    inicio: "/admin",
  },
  {
    id: "matriz",
    nombre: "Matriz de obligaciones",
    descripcion: "Obligaciones, vencimientos y evidencias de cada empresa",
    icono: "journal-check",
    inicio: "/admin/matriz",
    prefijo: "/admin/matriz",
  },
];

export const MODULO_POR_DEFECTO = "activos";

const CLAVE = "gestion_activos_modulo";

export function moduloPorId(id) {
  return MODULOS.find((modulo) => modulo.id === id) ?? MODULOS[0];
}

/** El módulo al que pertenece una ruta por su prefijo, o `null` si es común. */
export function moduloDeRuta(pathname) {
  const propio = MODULOS.find(
    (modulo) =>
      modulo.prefijo &&
      (pathname === modulo.prefijo ||
        pathname.startsWith(`${modulo.prefijo}/`)),
  );
  if (propio) return propio.id;
  return esRutaComun(pathname) ? null : MODULO_POR_DEFECTO;
}

const RUTAS_COMUNES = [...RUTAS_CONFIGURACION, "/admin/reportes"];

function esRutaComun(pathname) {
  return RUTAS_COMUNES.some(
    (ruta) => pathname === ruta || pathname.startsWith(`${ruta}/`),
  );
}

/** El último módulo elegido, para las pantallas comunes. */
export function moduloRecordado() {
  try {
    return sessionStorage.getItem(CLAVE) || MODULO_POR_DEFECTO;
  } catch {
    return MODULO_POR_DEFECTO;
  }
}

export function recordarModulo(id) {
  try {
    sessionStorage.setItem(CLAVE, id);
  } catch {
    // Sin almacenamiento, las pantallas comunes vuelven al módulo por
    // defecto: incómodo, pero nada se pierde.
  }
}
