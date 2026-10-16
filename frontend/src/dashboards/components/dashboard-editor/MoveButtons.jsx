/**
 * Alternativa accesible al arrastre (sección 21/22): siempre disponible, funciona con teclado y
 * en pantallas táctiles donde el drag and drop es incómodo.
 */
const BOTONES = [
  { direccion: 'inicio', etiqueta: 'Mover al inicio', icono: 'bi-chevron-double-left', haciaAtras: true },
  { direccion: 'arriba', etiqueta: 'Mover arriba', icono: 'bi-chevron-left', haciaAtras: true },
  { direccion: 'abajo', etiqueta: 'Mover abajo', icono: 'bi-chevron-right', haciaAtras: false },
  { direccion: 'fin', etiqueta: 'Mover al final', icono: 'bi-chevron-double-right', haciaAtras: false },
]

export default function MoveButtons({ onMover, deshabilitarArriba, deshabilitarAbajo }) {
  return (
    <div className="mz-edit-mover" role="group" aria-label="Mover componente">
      {BOTONES.map(({ direccion, etiqueta, icono, haciaAtras }) => (
        <button
          key={direccion}
          type="button"
          className="mz-icon-btn"
          onClick={() => onMover(direccion)}
          disabled={haciaAtras ? deshabilitarArriba : deshabilitarAbajo}
          aria-label={etiqueta}
          title={etiqueta}
        >
          <i className={`bi ${icono}`} aria-hidden="true"></i>
        </button>
      ))}
    </div>
  )
}
