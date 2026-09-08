import { useAppearance } from "../../../context/AppearanceContext";
import "./AparienciaTab.css";

const OPTIONS = [
  {
    value: "light",
    label: "Claro",
    description: "Fondos claros y texto oscuro en todo el panel administrativo.",
  },
  {
    value: "dark",
    label: "Oscuro",
    description: "Fondos oscuros y texto claro en todo el panel administrativo.",
  },
  {
    value: "system",
    label: "Usar configuración del sistema",
    description: "Sigue automáticamente la preferencia claro/oscuro del sistema operativo.",
  },
];

/**
 * Componente de presentación puro: el estado real vive en
 * `AppearanceContext`. A diferencia de las otras pestañas de Configuración,
 * no hay "Guardar" — el cambio de apariencia es una preferencia personal e
 * inmediata, no un dato de `SiteTheme`.
 */
export function AparienciaTab() {
  const { mode, setMode } = useAppearance();

  return (
    <fieldset className="apariencia-tab">
      <legend className="apariencia-tab__legend">Apariencia del panel administrativo</legend>
      <p className="apariencia-tab__hint">
        Elige cómo se ve la interfaz de administración en este dispositivo. El cambio se aplica de
        inmediato.
      </p>
      <div className="apariencia-tab__options">
        {OPTIONS.map((option) => (
          <label key={option.value} className="apariencia-tab__option">
            <input
              type="radio"
              name="appearance-mode"
              value={option.value}
              checked={mode === option.value}
              onChange={() => setMode(option.value)}
              aria-label={option.label}
            />
            <span className="apariencia-tab__option-text">
              <span className="apariencia-tab__option-label">{option.label}</span>
              <span className="apariencia-tab__option-description">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
