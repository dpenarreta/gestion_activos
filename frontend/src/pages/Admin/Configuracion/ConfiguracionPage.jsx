import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { themeService } from "../../../api/themeService";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { Icon } from "../../../components/common/Icon/Icon";
import { useUnsavedChanges } from "../../../context/UnsavedChangesContext";
import {
  evaluateThemeContrast,
  isValidHexColor,
} from "../../../utils/colorContrast";
import { mensajeDeError } from "../../../utils/errores";
import { AparienciaTab } from "./AparienciaTab";
import { ColoresTipografiaTab, COLOR_FIELDS } from "./ColoresTipografiaTab";
import { IdentidadTab } from "./IdentidadTab";

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
  const [guardado, setGuardado] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmResetOpen, setIsConfirmResetOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [errorDeCarga, setErrorDeCarga] = useState(null);

  // Si falla, la página decía nada y quedaba en blanco (auditoría UX/UI,
  // 28/10/2026): ahora muestra el error y deja reintentar.
  function cargar() {
    setErrorDeCarga(null);
    Promise.all([themeService.getAdmin(), themeService.getOptions()])
      .then(([data, opciones]) => {
        setForm(pickEditableFields(data));
        setOptions(opciones);
      })
      .catch((err) =>
        setErrorDeCarga(
          mensajeDeError(err, "No se pudo cargar la identidad visual."),
        ),
      );
  }

  useEffect(() => {
    cargar();
  }, []);

  const activeTab = location.pathname.endsWith("colores-tipografia")
    ? "colores"
    : location.pathname.endsWith("apariencia")
      ? "apariencia"
      : "identidad";

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setGuardado(false);
    setIsDirty(true);
  }

  const liveWarnings = form ? evaluateThemeContrast(form) : [];
  const failingContrast = liveWarnings.filter((entry) => !entry.passes);
  const hasInvalidHex = form
    ? COLOR_FIELDS.some((field) => !isValidHexColor(form[field.key]))
    : false;

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setGuardado(false);
    setIsSaving(true);
    try {
      const payload = { ...form, font_size_base: Number(form.font_size_base) };
      const response = await themeService.update(payload);
      setForm(pickEditableFields(response));
      setWarnings(response.warnings || []);
      setIsDirty(false);
      // Sin esto, guardar no daba ninguna señal y parecía no haber pasado nada.
      setGuardado(true);
    } catch (err) {
      // El detalle por campo primero: dice qué corregir.
      setError(mensajeDeError(err, "No se pudo guardar la configuración."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirmReset() {
    setIsResetting(true);
    setError(null);
    try {
      const response = await themeService.reset();
      setForm(pickEditableFields(response));
      setWarnings([]);
      setIsDirty(false);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudieron restaurar los valores."));
    } finally {
      setIsResetting(false);
      setIsConfirmResetOpen(false);
    }
  }

  if (!form || !options) {
    return (
      <div className="configuracion-page">
        <div className="mz-view-head">
          <div>
            <h2>Identidad visual</h2>
          </div>
        </div>
        {errorDeCarga ? (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            <span className="flex-grow-1">{errorDeCarga}</span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={cargar}
            >
              Reintentar
            </button>
          </div>
        ) : (
          <p className="mz-faint" role="status">
            Cargando…
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="configuracion-page">
      <div className="mz-view-head">
        <div>
          <h2>Identidad visual</h2>
          <p className="mz-desc">
            Cómo se presenta el sistema: su nombre, su logo, sus colores y su
            tipografía, y si este dispositivo lo muestra claro u oscuro.
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {/* Un solo aviso de éxito, anunciado (auditoría UX/UI, fase 2,
          28/10/2026): el pie repetía «Guardado» en verde suelto. */}
      {guardado && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check2-circle" />
          Cambios guardados. Ya se ven en todo el sistema.
        </div>
      )}

      {activeTab === "apariencia" ? (
        <div>
          <AparienciaTab />
        </div>
      ) : (
        <>
          {failingContrast.length > 0 && (
            <div className="mz-alert mz-alert--warn">
              <Icon name="exclamation-triangle" />
              <div>
                <strong>Advertencia de accesibilidad:</strong> las siguientes
                combinaciones no cumplen el contraste mínimo recomendado
                (4.5:1):
                <ul className="mb-0">
                  {failingContrast.map((entry) => (
                    <li key={entry.pair}>
                      {entry.pair} — contraste {entry.ratio}:1 (afecta:{" "}
                      {entry.foreground} sobre {entry.background})
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="mz-alert mz-alert--info" role="status">
              <Icon name="info-circle" />
              <div>
                La configuración se guardó. Advertencias de contraste
                pendientes: {warnings.map((w) => w.pair).join(", ")}.
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div>
              {activeTab === "identidad" ? (
                <IdentidadTab form={form} updateField={updateField} />
              ) : (
                <ColoresTipografiaTab
                  form={form}
                  updateField={updateField}
                  options={options}
                />
              )}
            </div>

            {/* Un solo pie para las dos pestañas: editan el mismo tema y se
                guardan juntas. */}
            <div className="mz-actions justify-content-end mt-3">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setIsConfirmResetOpen(true)}
              >
                <Icon name="arrow-counterclockwise" /> Restaurar valores por
                defecto
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSaving || hasInvalidHex}
              >
                {isSaving ? "Guardando…" : "Guardar"}
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
