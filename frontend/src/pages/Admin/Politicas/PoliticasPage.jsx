import { AdminTabs } from "../../../components/admin/AdminTabs/AdminTabs";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { DepreciacionPanel } from "./DepreciacionPanel";
import { PoliticasList } from "./PoliticasList";
import "./Politicas.css";

const BREADCRUMB_ITEMS = [
  { label: "Administración" },
  { label: "Políticas del parque" },
];

const TABS = [
  { key: "renovacion", label: "Renovación", path: "/admin/politicas" },
  {
    key: "depreciacion",
    label: "Depreciación",
    path: "/admin/politicas/depreciacion",
  },
];

/**
 * Las dos reglas configurables del parque, cada una en su pestaña.
 *
 * Van juntas porque las dos parten de la misma pregunta —cuánto dura un
 * equipo— y se responden con números distintos a propósito: la vida contable
 * dice en cuánto tiempo pierde su valor y la vida útil, cuándo conviene
 * reemplazarlo. Tenerlas a un clic una de otra es lo que hace evidente que son
 * dos cosas; en pantallas separadas se confundirían con más facilidad.
 */
export function PoliticasPage({ seccion = "renovacion" }) {
  return (
    <div className="politicas-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <h2>Políticas del parque</h2>

      <AdminTabs tabs={TABS} />

      <div
        className="pt-3"
        role="tabpanel"
        id={`admin-tabpanel-${seccion}`}
        aria-labelledby={`admin-tab-${seccion}`}
      >
        {seccion === "depreciacion" ? <DepreciacionPanel /> : <PoliticasList />}
      </div>
    </div>
  );
}
