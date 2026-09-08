import "./DevicePreviewFrame.css";

const DEFAULT_DEVICES = [
  { key: "desktop", label: "Escritorio" },
  { key: "tablet", label: "Tableta" },
  { key: "mobile", label: "Móvil" },
];

/**
 * Marco de vista previa con selector de dispositivo (escritorio/tableta/
 * móvil) — versión simplificada y autocontenida de lo que en el proyecto
 * original era un componente compartido más elaborado (`ResponsiveLivePreview`).
 * Puramente presentacional: el contenido a previsualizar se pasa como
 * `children`.
 */
export function DevicePreviewFrame({ device, onDeviceChange, devices = DEFAULT_DEVICES, children }) {
  return (
    <div className="device-preview-frame">
      <div className="device-preview-frame__tabs" role="tablist" aria-label="Dispositivo de vista previa">
        {devices.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={device === entry.key}
            className={`device-preview-frame__tab ${device === entry.key ? "device-preview-frame__tab--active" : ""}`}
            onClick={() => onDeviceChange(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className={`device-preview-frame__viewport device-preview-frame__viewport--${device}`}>
        {children}
      </div>
    </div>
  );
}
