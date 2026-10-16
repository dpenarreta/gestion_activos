/**
 * Componente puramente presentacional (sección "panel lateral de componentes", Zona Personal):
 * una línea divisoria suelta, sin datos — si `content.titulo` no está vacío, se muestra como
 * etiqueta centrada sobre la línea (mismo campo genérico que edita "Información general" del
 * panel de propiedades, sin UI especial para este tipo).
 */
export default function GenericSeparator({ content }) {
  const etiqueta = content?.titulo?.trim()
  if (!etiqueta) return <hr className="my-2" />
  return (
    <div className="d-flex align-items-center gap-2 my-2">
      <hr className="flex-grow-1 m-0" />
      <span className="chart-panel__subtitle text-nowrap mb-0">{etiqueta}</span>
      <hr className="flex-grow-1 m-0" />
    </div>
  )
}
