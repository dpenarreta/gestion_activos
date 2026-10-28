import "./Button.css";

export function Button({
  children,
  variant = "primary",
  isLoading = false,
  disabled = false,
  ...props
}) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} app-button`}
      disabled={isLoading || disabled}
      {...props}
    >
      {/* No siempre guarda (entrar, enviar un enlace, confirmar un borrado):
          «Procesando…», con los puntos suspensivos tipográficos como el resto
          del sistema (auditoría UX/UI, fase 3, 28/10/2026). */}
      {isLoading ? "Procesando…" : children}
    </button>
  );
}
