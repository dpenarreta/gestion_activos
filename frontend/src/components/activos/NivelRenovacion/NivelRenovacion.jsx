import { Icon } from "../../common/Icon/Icon";

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
    clase: "mz-pill--warn",
    etiqueta: "Evaluar reemplazo",
    icono: "eye",
  },
  recomendado: {
    clase: "mz-pill--bad",
    etiqueta: "Reemplazo recomendado",
    icono: "exclamation-octagon",
  },
};

export function NivelRenovacion({ nivel, etiqueta, conIcono = false }) {
  const variante = VARIANTES[nivel];
  // «ninguno» no dibuja nada: una etiqueta verde de «sin sugerencia» en cada fila
  // del inventario compite visualmente con los pocos que sí necesitan atención.
  if (!variante) {
    return null;
  }

  return (
    <span className={`mz-pill ${variante.clase}`}>
      {conIcono && <Icon name={variante.icono} />}
      {etiqueta || variante.etiqueta}
    </span>
  );
}
