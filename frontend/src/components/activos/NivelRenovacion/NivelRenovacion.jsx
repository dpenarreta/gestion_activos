/**
 * Severidad de la sugerencia de reemplazo (§11 del documento funcional).
 *
 * Son dos niveles y no uno porque con una sola alerta había que elegir entre
 * avisar tarde o llenar la pantalla de avisos que nadie puede atender todos a
 * la vez: «evaluar» abre la conversación y «recomendado» es lo que se
 * presupuesta.
 */
const VARIANTES = {
  evaluar: {
    clase: "text-bg-warning",
    etiqueta: "Evaluar reemplazo",
    icono: "eye",
  },
  recomendado: {
    clase: "text-bg-danger",
    etiqueta: "Reemplazo recomendado",
    icono: "exclamation-octagon",
  },
};

export function NivelRenovacion({ nivel, etiqueta, conIcono = false }) {
  const variante = VARIANTES[nivel];
  // «ninguno» no dibuja nada: un badge verde de «sin sugerencia» en cada fila
  // del inventario compite visualmente con los pocos que sí necesitan atención.
  if (!variante) {
    return null;
  }

  return (
    <span className={`badge ${variante.clase}`}>
      {conIcono && <i className={`bi bi-${variante.icono} me-1`} aria-hidden="true" />}
      {etiqueta || variante.etiqueta}
    </span>
  );
}
