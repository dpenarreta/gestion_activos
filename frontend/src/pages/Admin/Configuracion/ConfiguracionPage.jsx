import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { themeService } from "../../../api/themeService";
import { AdminTabs } from "../../../components/admin/AdminTabs/AdminTabs";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { Button } from "../../../components/common/Button/Button";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { useUnsavedChanges } from "../../../context/UnsavedChangesContext";
import { evaluateThemeContrast, isValidHexColor } from "../../../utils/colorContrast";
import { AparienciaTab } from "./AparienciaTab";
import { ColoresTipografiaTab, COLOR_FIELDS } from "./ColoresTipografiaTab";
import { IdentidadTab } from "./IdentidadTab";
import "./ConfiguracionPage.css";

const TABS = [
  { key: "identidad", label: "Identidad", path: "/admin/configuracion/identidad" },
  { key: "colores", label: "Colores y tipografía", path: "/admin/configuracion/colores-tipografia" },
  { key: "apariencia", label: "Apariencia", path: "/admin/configuracion/apariencia" },
];

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Configuración" }];

const EDITABLE_FIELDS = [
  "site_name",
  "short_name",
  "logo_url",
  "favicon_url",
  "color_primary",
  "color_secondary",
  "color_background",
  "color_headings",
  "color_text",
  "color_links",
  "color_buttons",
  "color_menu",
  "font_primary",
  "font_secondary",
  "font_size_base",
  "border_radius",
];

function pickEditableFields(theme) {
  const result = {};
  EDITABLE_FIELDS.forEach((key) => {
    result[key] = theme[key];
  });
  return result;
}

/**
 * Host del módulo "Configuración": pestañas "Identidad", "Colores y
 * tipografía" y "Apariencia", cada una con su propia URL. El estado del
 * formulario vive aquí (no en las tabs, presentación pura) porque las
 * primeras dos pestañas editan el mismo `SiteTheme` y comparten un único
 * guardado/reseteo/auditoría.
 *
 * Módulo agregado deliberadamente más allá del mínimo estricto de este
 * template base (identidad estática) — a pedido explícito, con edición
 * completa. Ver docs/architecture.md y tests/qa/features/branding.feature.
 */
export function ConfiguracionPage() {
  const location = useLocation();
  const { setIsDirty } = useUnsavedChanges();
  const [form, setForm] = useState(null);
  const [options, setOptions] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmResetOpen, setIsConfirmResetOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    themeService.getAdmin().then((data) => setForm(pickEditableFields(data)));
    themeService.getOptions().then(setOptions);
  }, []);

  const activeTab = location.pathname.endsWith("colores-tipografia")
    ? "colores"
    : location.pathname.endsWith("apariencia")
      ? "apariencia"
      : "identidad";

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setIsDirty(true);
  }

  const liveWarnings = form ? evaluateThemeContrast(form) : [];
  const failingContrast = liveWarnings.filter((entry) => !entry.passes);
  const hasInvalidHex = form ? COLOR_FIELDS.some((field) => !isValidHexColor(form[field.key])) : false;

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const payload = { ...form, font_size_base: Number(form.font_size_base) };
      const response = await themeService.update(payload);
      setForm(pickEditableFields(response));
      setWarnings(response.warnings || []);
      setIsDirty(false);
    } catch (err) {
      setError(err.response?.data?.error?.message || "No se pudo guardar la configuración.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirmReset() {
    setIsResetting(true);
    try {
      const response = await themeService.reset();
      setForm(pickEditableFields(response));
      setWarnings([]);
      setIsDirty(false);
    } finally {
      setIsResetting(false);
      setIsConfirmResetOpen(false);
    }
  }

  if (!form || !options) {
    return null;
  }

  return (
    <div className="configuracion-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <h2>Configuración</h2>

      <AdminTabs tabs={TABS} />

      {error && <div className="alert alert-danger">{error}</div>}

      {activeTab === "apariencia" ? (
        <div role="tabpanel" id="admin-tabpanel-apariencia" aria-labelledby="admin-tab-apariencia">
          <AparienciaTab />
        </div>
      ) : (
        <>
          {failingContrast.length > 0 && (
            <div className="alert alert-warning">
              <strong>Advertencia de accesibilidad:</strong> las siguientes combinaciones no cumplen el
              contraste mínimo recomendado (4.5:1):
              <ul className="mb-0">
                {failingContrast.map((entry) => (
                  <li key={entry.pair}>
                    {entry.pair} — contraste {entry.ratio}:1 (afecta: {entry.foreground} sobre{" "}
                    {entry.background})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="alert alert-info">
              La configuración se guardó. Advertencias de contraste pendientes:{" "}
              {warnings.map((w) => w.pair).join(", ")}.
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div
              role="tabpanel"
              id={`admin-tabpanel-${activeTab}`}
              aria-labelledby={`admin-tab-${activeTab}`}
            >
              {activeTab === "identidad" ? (
                <IdentidadTab form={form} updateField={updateField} />
              ) : (
                <ColoresTipografiaTab form={form} updateField={updateField} options={options} />
              )}
            </div>

            <div className="d-flex gap-2 mt-3">
              <Button type="submit" isLoading={isSaving} disabled={hasInvalidHex}>
                Guardar
              </Button>
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setIsConfirmResetOpen(true)}
              >
                Restaurar valores por defecto
              </button>
            </div>
          </form>
        </>
      )}

      <ConfirmDialog
        isOpen={isConfirmResetOpen}
        title="Restaurar valores por defecto"
        message="Se perderá toda la personalización visual actual y se volverá al tema predeterminado. ¿Confirma la operación?"
        isLoading={isResetting}
        onConfirm={handleConfirmReset}
        onCancel={() => setIsConfirmResetOpen(false)}
      />
    </div>
  );
}
