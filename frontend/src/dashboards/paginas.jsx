import { lazy, Suspense } from "react";

/*
 * Lo que las rutas del sistema montan del módulo de Dashboards. Se carga bajo
 * demanda: el fragmento lleva Recharts, html2canvas y jsPDF.
 */
const entrada = () => import("./entradas");

function diferida(nombre) {
  const Pagina = lazy(() => entrada().then((m) => ({ default: m[nombre] })));
  function PaginaDiferida() {
    return (
      <Suspense fallback={<p className="mz-faint">Cargando…</p>}>
        <Pagina />
      </Suspense>
    );
  }
  PaginaDiferida.displayName = `Dashboards${nombre}`;
  return PaginaDiferida;
}

export const DashboardsListado = diferida("Listado");
export const DashboardsDetalle = diferida("Dashboard");
export const DashboardsHistorico = diferida("Historico");
export const DashboardsPlantillaBase = diferida("PlantillaBase");
