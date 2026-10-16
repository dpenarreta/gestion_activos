import { Alert, Button, Spinner } from 'react-bootstrap'
import { useAuth } from '../../context/AuthContext'
import { usePlantillaBaseLayout } from '../../hooks/usePlantillaBaseLayout'
import EditModeToolbar from '../../components/dashboard-editor/EditModeToolbar'
import EditableGrid from '../../components/dashboard-editor/EditableGrid'
import ComponentPropertiesPanel from '../../components/dashboard-editor/ComponentPropertiesPanel'
import GenericChartRenderer from '../../components/dashboard-generic/GenericChartRenderer'
import TablaHistoricaAutomatica from '../../components/dashboard-generic/TablaHistoricaAutomatica'
import { construirOverride, datosDesdeComponente } from '../../utils/datosDesdeComponente'
import { DASHBOARD_ID_PLANTILLA_BASE } from '../../utils/plantillaSlots'

/**
 * Plantilla base personalizable: las mismas 13 posiciones fijas de todo dashboard (4 KPI, 6
 * gráficos, 3 tablas), editables con el mismo editor de arrastrar/redimensionar/reordenar/
 * recolorear/renombrar/cambiar tipo de gráfico que un dashboard real (`EditableGrid`,
 * `ComponentPropertiesPanel`) — mucho más liviana que `DashboardAreaPage.jsx`: sin pestañas, sin
 * carga de archivo, sin nombre/área propios. Lo que se guarde acá pasa a ser lo que reciben todos
 * los dashboards creados de ahí en adelante (`services/plantilla.py::sembrar_plantilla_desde_base`),
 * nunca afecta retroactivamente a los ya existentes. "Restablecer al patrón Z" vuelve a los
 * valores de fábrica (KPIs arriba, gráfico de ancho completo justo debajo como ancla del barrido
 * diagonal, etc.).
 */
export default function PlantillaBasePage() {
  const { user } = useAuth()
  const puedeEditar = user?.permissions?.includes('configuracion.editar')
  const layout = usePlantillaBaseLayout()

  const cargandoInicial = layout.layoutGuardado === null

  const registro = Object.fromEntries(layout.borrador.map((c) => [
    c.component_id,
    {
      render: (componente) => {
        if (componente.type !== 'kpi' && componente.type !== 'chart') return null
        const override = construirOverride(componente)
        const { datos, datosMultiserie } = datosDesdeComponente(componente)
        const esTablaHistorica = componente.component_id === 'tabla-3'
        const esHistorica = esTablaHistorica || Boolean(componente.mapeo?.usa_historico)
        const contenidoNormal = (
          <GenericChartRenderer
            tipoVisualizacion={componente.type === 'kpi' ? 'kpi' : (componente.chart_type || 'barras_horizontales')}
            datos={datos}
            datosMultiserie={datosMultiserie}
            titulo={componente.content?.titulo}
            override={override}
            config={componente.config}
            esHistorica={esHistorica}
          />
        )
        // Tabla 3 también compara en vivo el histórico de cargas acá — en la práctica siempre
        // cae a `contenidoNormal` (dato ficticio), ya que a la plantilla base nunca se le sube un
        // archivo real (no tiene columnas históricas configuradas), pero se mantiene el mismo
        // comportamiento que un dashboard real por consistencia.
        if (esTablaHistorica) {
          return (
            <TablaHistoricaAutomatica
              dashboardId={DASHBOARD_ID_PLANTILLA_BASE}
              override={override}
              contenidoNormal={contenidoNormal}
            />
          )
        }
        return contenidoNormal
      },
    },
  ]))

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Plantilla base de dashboards</h2>
          <p className="mz-desc">
            Estas 13 posiciones, con datos de ejemplo, son las que trae todo dashboard nuevo desde
            su creación. Los cambios guardados acá no afectan a los dashboards que ya existen.
          </p>
        </div>
      </div>


      {cargandoInicial && layout.error && <Alert variant="danger">{layout.error}</Alert>}
      {cargandoInicial && !layout.error && <div className="text-center mb-3" role="status"><Spinner animation="border" /></div>}

      {!cargandoInicial && (
        <>
          {puedeEditar && (
            <div className="d-flex justify-content-end mb-3">
              <EditModeToolbar
                modoEdicion={layout.modoEdicion}
                vistaPrevia={layout.vistaPrevia}
                cargando={layout.cargando}
                hayCambiosSinGuardar={layout.hayCambiosSinGuardar}
                onActivarEdicion={layout.activarEdicion}
                onGuardar={layout.guardar}
                onCancelar={layout.cancelar}
                onAlternarVistaPrevia={layout.alternarVistaPrevia}
                onRestablecer={layout.restablecer}
                activarBoton="Editar plantilla base"
                restablecerBoton="Restablecer al patrón Z"
                restablecerTitulo="Restablecer al patrón Z recomendado"
                restablecerDescripcion="Esta acción descarta toda la personalización (título, tipo de gráfico, color, tamaño, orden) y vuelve la plantilla base a los valores de fábrica. No afecta a los dashboards que ya existen. No se puede deshacer (aunque queda registrada en el historial)."
              />
            </div>
          )}

          {layout.error && !cargandoInicial && <Alert variant="danger">{layout.error}</Alert>}
          {layout.conflicto && (
            <Alert variant="warning" className="d-flex justify-content-between align-items-center">
              <span>Existe una versión más reciente de la plantilla base guardada por otra persona.</span>
              <Button size="sm" variant="warning" onClick={layout.recargarPorConflicto}>Recargar configuración</Button>
            </Alert>
          )}

          <EditableGrid
            componentes={layout.borrador}
            registro={registro}
            modoEdicion={puedeEditar && layout.modoEdicion}
            vistaPrevia={layout.vistaPrevia}
            seleccionado={layout.seleccionado}
            onSeleccionar={layout.setSeleccionado}
            onMover={layout.moverComponente}
            onOcultar={(id) => layout.actualizarComponente(id, { is_visible: false })}
            onMostrar={(id) => layout.actualizarComponente(id, { is_visible: true })}
            onReordenar={layout.reordenarPorIds}
            permiteEstilo
            permiteEliminar={false}
          />

          {puedeEditar && layout.modoEdicion && !layout.vistaPrevia && (
            <ComponentPropertiesPanel
              componente={layout.seleccionado ? layout.borrador.find((c) => c.component_id === layout.seleccionado) : null}
              onCerrar={() => layout.setSeleccionado(null)}
              onActualizarContenido={layout.actualizarContenido}
              onActualizarEstilos={layout.actualizarEstilos}
              onCambiarAncho={(id, w) => layout.actualizarComponente(id, { width: w })}
              onCambiarAlto={(id, h) => layout.actualizarComponente(id, { height: h })}
              onActualizarConfig={(id, config) => layout.actualizarComponente(id, { config })}
              onActualizarComponente={layout.actualizarComponente}
              modoPlantillaBase
            />
          )}
        </>
      )}
    </div>
  )
}
