import { useParams } from "react-router-dom";

import { ModuloDashboards } from "./ModuloDashboards";
import DashboardAreaPage from "./pages/dashboards/DashboardAreaPage";
import DashboardHistoricoPage from "./pages/dashboards/DashboardHistoricoPage";
import DashboardsListPage from "./pages/dashboards/DashboardsListPage";
import PlantillaBasePage from "./pages/plantilla/PlantillaBasePage";
import InteraccionPlataformaPage, {
  DASHBOARD_INTERACCION,
} from "./pages/interaccion/InteraccionPlataformaPage";

/*
 * Las pantallas del módulo, cada una dentro de su raíz. Este archivo es la
 * entrada del fragmento que se descarga al abrir Dashboards (ver `paginas.jsx`):
 * los gráficos y la exportación a PDF pesan, y quien no usa el módulo no tiene
 * por qué descargarlos.
 */
export function Listado() {
  return (
    <ModuloDashboards>
      <DashboardsListPage />
    </ModuloDashboards>
  );
}

export function Dashboard() {
  const { dashboardId } = useParams();
  // «Interacción de la plataforma» lo calcula el sistema: no se carga desde
  // Excel ni se arma con el editor (18/11/2026).
  return (
    <ModuloDashboards>
      {dashboardId === DASHBOARD_INTERACCION ? (
        <InteraccionPlataformaPage />
      ) : (
        <DashboardAreaPage />
      )}
    </ModuloDashboards>
  );
}

export function Historico() {
  return (
    <ModuloDashboards>
      <DashboardHistoricoPage />
    </ModuloDashboards>
  );
}

export function PlantillaBase() {
  return (
    <ModuloDashboards>
      <PlantillaBasePage />
    </ModuloDashboards>
  );
}
