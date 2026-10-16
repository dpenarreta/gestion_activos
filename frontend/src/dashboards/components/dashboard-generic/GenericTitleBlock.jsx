/**
 * Componente puramente presentacional (sección "panel lateral de componentes", Zona Personal):
 * un bloque de encabezado suelto, sin datos — `content.titulo`/`descripcion` son los mismos
 * campos que "Información general" del panel de propiedades ya edita de forma genérica para
 * cualquier componente, así que no hace falta ninguna UI de edición especial para este tipo.
 */
export default function GenericTitleBlock({ content }) {
  return (
    <div className="chart-panel">
      <h4 className="mb-0">{content?.titulo}</h4>
      {content?.descripcion && <div className="chart-panel__subtitle">{content.descripcion}</div>}
    </div>
  )
}
