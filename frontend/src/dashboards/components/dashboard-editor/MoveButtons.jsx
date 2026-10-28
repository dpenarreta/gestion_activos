/**
 * Alternativa accesible al arrastre (sección 21/22): siempre disponible, funciona con teclado y
 * en pantallas táctiles donde el drag and drop es incómodo.
 */
//
// Auditoría UX/UI, fase 3, 28/10/2026: los chevrones apuntan a izquierda/derecha (la rejilla fluye
// en filas), así que «Mover arriba/abajo» no describía lo que se ve: ahora es «antes»/«después».
// Con `nombre`, cada botón dice qué componente mueve (`Mover "Cartera vencida" antes`): sin él,
// un lector de pantalla oía cuatro «Mover…» idénticos por cada componente del dashboard.
const BOTONES = [
  { direccion: 'inicio', accion: 'al inicio', icono: 'bi-chevron-double-left', haciaAtras: true },
  { direccion: 'arriba', accion: 'antes', icono: 'bi-chevron-left', haciaAtras: true },
  { direccion: 'abajo', accion: 'después', icono: 'bi-chevron-right', haciaAtras: false },
  { direccion: 'fin', accion: 'al final', icono: 'bi-chevron-double-right', haciaAtras: false },
]

export default function MoveButtons({ onMover, deshabilitarArriba, deshabilitarAbajo, nombre }) {
  return (
    <div className="mz-edit-mover" role="group" aria-label={nombre ? `Mover "${nombre}"` : 'Mover componente'}>
      {BOTONES.map(({ direccion, accion, icono, haciaAtras }) => (
        <button
          key={direccion}
          type="button"
          className="mz-icon-btn"
          onClick={() => onMover(direccion)}
          disabled={haciaAtras ? deshabilitarArriba : deshabilitarAbajo}
          aria-label={nombre ? `Mover "${nombre}" ${accion}` : `Mover ${accion}`}
          title={`Mover ${accion}`}
        >
          <i className={`bi ${icono}`} aria-hidden="true"></i>
        </button>
      ))}
    </div>
  )
}
