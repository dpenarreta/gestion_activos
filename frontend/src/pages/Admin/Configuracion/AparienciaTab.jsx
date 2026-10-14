import { Icon } from "../../../components/common/Icon/Icon";
import { useAppearance } from "../../../context/AppearanceContext";
import "./AparienciaTab.css";

const OPTIONS = [
  {
    value: "light",
    label: "Claro",
    icon: "sun",
    description:
      "Fondos claros y texto oscuro en todo el panel administrativo.",
  },
  {
    value: "dark",
    label: "Oscuro",
    icon: "moon-stars",
    description:
      "Fondos oscuros y texto claro en todo el panel administrativo.",
  },
  {
    value: "system",
    label: "Usar configuración del sistema",
    icon: "circle-half",
    description:
      "Sigue automáticamente la preferencia claro/oscuro del sistema operativo.",
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
    <section className="mz-card apariencia-tab">
      <fieldset className="mz-card-body">
        <legend className="apariencia-tab__legend">
          Apariencia del panel administrativo
        </legend>
        <p className="mz-small mz-faint">
          Elige cómo se ve la interfaz de administración en este dispositivo. El
          cambio se aplica de inmediato.
        </p>
        <div className="apariencia-tab__options">
          {OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`apariencia-tab__option${mode === option.value ? " is-on" : ""}`}
            >
              <input
                type="radio"
                className="form-check-input"
                name="appearance-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
                aria-label={option.label}
              />
              <Icon name={option.icon} className="apariencia-tab__icon" />
              <span>
                <span className="apariencia-tab__option-label">
                  {option.label}
                </span>
                <span className="apariencia-tab__option-description">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
