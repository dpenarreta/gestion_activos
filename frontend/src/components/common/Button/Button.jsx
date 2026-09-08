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
      className={`btn app-button app-button--${variant}`}
      disabled={isLoading || disabled}
      {...props}
    >
      {isLoading ? "Procesando..." : children}
    </button>
  );
}
