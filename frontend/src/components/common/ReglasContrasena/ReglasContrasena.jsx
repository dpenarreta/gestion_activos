import "./ReglasContrasena.css";

/**
 * Las reglas de las contraseñas (26/10/2026), las mismas que valida el
 * servidor (`apps/authentication/validators.py`): al menos 8 caracteres, una
 * mayúscula, un número y un signo especial. Cada una se marca en cuanto se
 * cumple, mientras se escribe.
 */
export const REGLAS_CONTRASENA = [
  ["largo", "Al menos 8 caracteres", (c) => c.length >= 8],
  ["mayuscula", "Una letra mayúscula", (c) => /\p{Lu}/u.test(c)],
  ["numero", "Un número", (c) => /\d/.test(c)],
  [
    "signo",
    "Un signo especial (@, #, $, !, *…)",
    (c) => /[^\p{L}\p{N}\s]/u.test(c),
  ],
];

export function cumpleReglas(clave) {
  return REGLAS_CONTRASENA.every(([, , cumple]) => cumple(clave ?? ""));
}

export function ReglasContrasena({ clave = "", id }) {
  return (
    <ul
      id={id}
      className="reglas-contrasena"
      aria-label="Requisitos de la contraseña"
    >
      {REGLAS_CONTRASENA.map(([clavePropia, texto, cumple]) => {
        const ok = cumple(clave);
        return (
          <li
            key={clavePropia}
            className={
              ok ? "reglas-contrasena__ok" : "reglas-contrasena__falta"
            }
          >
            <i
              className={`bi ${ok ? "bi-check-circle-fill" : "bi-circle"}`}
              aria-hidden="true"
            />
            {texto}
            <span className="visually-hidden">
              {ok ? ": cumple" : ": falta"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
