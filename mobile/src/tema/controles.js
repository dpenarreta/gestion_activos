import { AREA_TACTIL, colores } from "./colores";

/**
 * Los estilos de los controles que se repetían pantalla por pantalla
 * (auditoría UX móvil, H-20, 12/11/2026): la opción de un grupo de radios, el
 * campo de texto y la píldora de un filtro. Son objetos simples, sin pasar
 * por `crearEstilos`: cada pantalla los mezcla en los suyos (`...CONTROLES.opcion`)
 * y `crearEstilos` les pone la fuente, así la vuelta a la fuente del sistema
 * sigue funcionando.
 */
export const CONTROLES = {
  /** Una opción de un grupo de radios: borde de control (4,5:1) y, la
   * elegida, borde negro de 2 y fondo `realce`. */
  opcion: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colores.bordeControl,
    borderRadius: 8,
    backgroundColor: colores.superficie,
  },
  opcionActiva: { borderColor: colores.primario, borderWidth: 2, backgroundColor: colores.realce },
  opcionTexto: { flexShrink: 1, fontSize: 16, color: colores.tinta },

  /** Un campo de texto de una línea. */
  entrada: {
    minHeight: AREA_TACTIL,
    borderWidth: 1,
    borderColor: colores.bordeControl,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colores.tinta,
    backgroundColor: colores.superficie,
  },
  entradaConError: { borderColor: colores.malTexto, borderWidth: 2 },

  /** La píldora de un filtro («Todas», «Sin leer»…). */
  pildora: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colores.bordeControl,
    backgroundColor: colores.superficie,
  },
  pildoraActiva: { backgroundColor: colores.primario, borderColor: colores.primario },
  pildoraTexto: { fontSize: 15, fontWeight: "600", color: colores.tinta, flexShrink: 1 },
  pildoraTextoActivo: { color: colores.sobrePrimario },

  /** El número rojo de pendientes: blanco sobre `malTexto` (7,3:1). */
  insignia: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 11,
    backgroundColor: colores.malTexto,
    alignItems: "center",
  },
  insigniaTexto: { color: colores.sobrePrimario, fontSize: 12, fontWeight: "700" },
};
