/**
 * Único lugar que construye la clase `bi bi-*` de Bootstrap Icons — nadie
 * más en la aplicación debe hardcodearla. Decorativo por defecto
 * (`aria-hidden`); con `label` se vuelve un ícono con significado propio
 * (`role="img"` + `aria-label`).
 */
export function Icon({ name, label, className = "" }) {
  if (!name) {
    return null;
  }
  const classes = `bi bi-${name}${className ? ` ${className}` : ""}`;
  if (label) {
    return <i className={classes} role="img" aria-label={label} />;
  }
  return <i className={classes} aria-hidden="true" />;
}
