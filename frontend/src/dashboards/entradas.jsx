import { ModuloDashboards } from "./ModuloDashboards";
import DashboardAreaPage from "./pages/dashboards/DashboardAreaPage";
import DashboardHistoricoPage from "./pages/dashboards/DashboardHistoricoPage";
import DashboardsListPage from "./pages/dashboards/DashboardsListPage";
import PlantillaBasePage from "./pages/plantilla/PlantillaBasePage";

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
  return (
    <ModuloDashboards>
      <DashboardAreaPage />
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
