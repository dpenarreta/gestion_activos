import { useEffect, useRef, useState } from "react";

/**
 * Las piezas con las que la ficha del usuario reparte roles.
 *
 * Antes cada empresa mostraba una rejilla con todos los roles del catálogo
 * —decenas de casillas— y el rol elegido en el alta quedaba perdido entre
 * ellas; debajo, otra rejilla igual para los roles globales parecía un segundo
 * rol «para permisos» (queja de usuario, 06/11/2026). Ahora el rol se maneja
 * con el mismo desplegable que en el alta, y lo raro —un segundo rol en la
 * misma empresa— se añade a propósito desde un botón discreto.
 */

/** El botón «Quitar» de la ficha de un rol, para enfocarlo desde fuera. */
export function fichaDeRol(contenedor, rolId) {
  return contenedor?.querySelector(`[data-rol-id="${rolId}"]`) ?? null;
}

/**
 * Los roles que ya tiene, como fichas con «Quitar».
 *
 * Al quitar uno el foco pasa a la ficha siguiente o, si no queda ninguna, a
 * donde diga `focoAlVaciar`: si se quedara en un botón que ya no existe, el
 * teclado volvería al principio de la página.
 */
export function FichasDeRoles({
  id,
  titulo,
  roles,
  contexto,
  deshabilitado,
  onQuitar,
  focoAlVaciar,
}) {
  const lista = useRef(null);
  if (roles.length === 0) return null;

  function quitar(rolId, indice) {
    onQuitar(rolId);
    requestAnimationFrame(() => {
      const botones = lista.current?.querySelectorAll("button") ?? [];
      const siguiente = botones[Math.min(indice, botones.length - 1)];
      (siguiente ?? focoAlVaciar?.())?.focus();
    });
  }

  return (
    <div className="empresas-asignacion__fichas">
      <span id={id} className="empresas-asignacion__etiqueta">
        {titulo}
      </span>
      <ul ref={lista} aria-labelledby={id}>
        {roles.map((rol, indice) => (
          <li key={rol.id} className="empresas-asignacion__ficha">
            <span>{rol.name}</span>
            {!deshabilitado && (
              <button
                type="button"
                className="btn btn-link btn-sm"
                data-rol-id={rol.id}
                // «Quitar» a secas, repetido, no dice qué ni dónde.
                aria-label={`Quitar el rol ${rol.name}${contexto}`}
                onClick={() => quitar(rol.id, indice)}
              >
                Quitar
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Un botón discreto que, al pulsarlo, abre un desplegable para sumar un rol.
 *
 * Se suma con «Añadir» y no al cambiar el desplegable: en Windows las flechas
 * cambian el valor de un `<select>` cerrado, y quien recorriera la lista con
 * el teclado iría añadiendo cada rol por el que pasara.
 *
 * Al cerrar, el foco vuelve al botón; si el rol añadido era la última opción
 * el botón ya no existe, y el foco va a donde diga `focoTrasAnadir` (la ficha
 * recién añadida) para no caer al principio de la página.
 */
export function AnadirRol({
  idBase,
  textoBoton,
  etiqueta,
  opciones,
  onAnadir,
  botonRef,
  focoTrasAnadir,
}) {
  const [abierto, setAbierto] = useState(false);
  const [elegido, setElegido] = useState("");
  const desplegable = useRef(null);
  const propio = useRef(null);
  const boton = botonRef ?? propio;

  useEffect(() => {
    if (abierto) desplegable.current?.focus();
  }, [abierto]);

  function cerrar(anadido = null) {
    setAbierto(false);
    setElegido("");
    // El botón vuelve a dibujarse al cerrar: se enfoca en el cuadro siguiente.
    requestAnimationFrame(() =>
      (
        boton.current ?? (anadido !== null ? focoTrasAnadir?.(anadido) : null)
      )?.focus(),
    );
  }

  if (opciones.length === 0) return null;

  if (!abierto) {
    return (
      <button
        ref={boton}
        type="button"
        className="btn btn-link btn-sm empresas-asignacion__anadir"
        onClick={() => setAbierto(true)}
      >
        {textoBoton}
      </button>
    );
  }

  return (
    // Escape cierra desde cualquier control del panel, no solo desde el
    // desplegable (auditoría UX/UI, 06/11/2026).
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className="empresas-asignacion__otro"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          cerrar();
        }
      }}
    >
      <label htmlFor={`${idBase}-otro`}>{etiqueta}</label>
      <div className="empresas-asignacion__otro-fila">
        <select
          ref={desplegable}
          id={`${idBase}-otro`}
          className="form-select form-select-sm"
          value={elegido}
          onChange={(event) => setElegido(event.target.value)}
        >
          <option value="">Seleccione un rol</option>
          {opciones.map((rol) => (
            <option key={rol.id} value={rol.id}>
              {rol.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-outline-primary btn-sm"
          disabled={!elegido}
          onClick={() => {
            const rolId = Number(elegido);
            onAnadir(rolId);
            cerrar(rolId);
          }}
        >
          Añadir
        </button>
        <button
          type="button"
          className="btn btn-link btn-sm"
          onClick={() => cerrar()}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * El rol de la persona en una empresa: el desplegable del alta, los roles
 * adicionales si los tiene y el que le pone su cargo, que solo se muestra.
 *
 * `asignados` es la lista tal como viaja al servidor (con el de cargo, si lo
 * hay); el primero de los manuales es el principal, salvo con `sinPrincipal`:
 * elegir «Sin rol principal» quita solo ese y deja los adicionales donde
 * estaban, en vez de subir uno en silencio (auditoría UX/UI, 06/11/2026).
 *
 * Con una sola empresa, si no tiene rol aquí pero sí uno global, se dice bajo
 * el desplegable y se ofrece pasarlo a la empresa: era justo la queja, el rol
 * real en un sitio y «Sin rol» en el otro.
 */
export function RolEnEmpresa({
  empresa,
  unica,
  asignados,
  sinPrincipal,
  opciones,
  nombreDe,
  esDeCargo,
  deshabilitado,
  ayudaId,
  avisoId,
  globales = [],
  onPasarGlobal,
  onCambiar,
  anunciar,
}) {
  const principalRef = useRef(null);
  const anadirRef = useRef(null);
  const contenedor = useRef(null);
  const manuales = asignados.filter((id) => !esDeCargo(id));
  const deCargo = asignados.filter((id) => esDeCargo(id));
  const principal = sinPrincipal ? undefined : manuales[0];
  const adicionales = sinPrincipal ? manuales : manuales.slice(1);
  const enEmpresa = unica ? "" : ` en ${empresa.nombre}`;
  const idBase = `rol-${empresa.id}`;
  const conGlobal = unica && principal === undefined && globales.length > 0;
  // El desplegable se describe solo con la frase «Ya tiene…», no con el
  // bloque entero: el texto del botón leído como descripción sobraba
  // (auditoría UX/UI, 06/11/2026).
  const idGlobal = (rolId) => `${idBase}-global-${rolId}`;
  const globalId = conGlobal
    ? globales.map((rol) => idGlobal(rol.id)).join(" ")
    : null;

  // Si tiene un rol que el catálogo no trae (sin `roles.ver` o recién borrado)
  // se sigue mostrando: un desplegable en blanco haría creer que no tiene.
  const delDesplegable = [
    ...opciones,
    ...manuales
      .filter((id) => !opciones.some((rol) => rol.id === id))
      .map((id) => ({ id, name: nombreDe(id) })),
  ];

  function elegirPrincipal(valor) {
    if (!valor) {
      onCambiar([...adicionales, ...deCargo], adicionales.length > 0);
      if (principal !== undefined)
        anunciar(
          `Rol ${nombreDe(principal)} quitado${enEmpresa}; sin guardar.`,
        );
      return;
    }
    const nuevo = Number(valor);
    onCambiar(
      [nuevo, ...adicionales.filter((id) => id !== nuevo), ...deCargo],
      false,
    );
    anunciar(`Rol ${nombreDe(nuevo)} elegido${enEmpresa}; sin guardar.`);
  }

  return (
    <div ref={contenedor} className="empresas-asignacion__rol">
      <div className="mz-field mb-0">
        <label htmlFor={idBase}>
          Rol
          {!unica && <span className="visually-hidden">{enEmpresa}</span>}
        </label>
        <select
          ref={principalRef}
          id={idBase}
          className="form-select"
          value={principal ?? ""}
          disabled={deshabilitado}
          aria-describedby={
            [ayudaId, globalId, avisoId].filter(Boolean).join(" ") || undefined
          }
          onChange={(event) => elegirPrincipal(event.target.value)}
        >
          <option value="">
            {adicionales.length > 0
              ? "Sin rol principal"
              : "Sin rol en esta empresa"}
          </option>
          {delDesplegable.map((rol) => (
            <option key={rol.id} value={rol.id}>
              {rol.name}
            </option>
          ))}
        </select>
      </div>

      {conGlobal && (
        <div className="mz-small mt-1">
          {globales.map((rol) => (
            <p key={rol.id} className="mb-0">
              <span id={idGlobal(rol.id)}>
                Ya tiene {rol.name} en todas las empresas.
              </span>{" "}
              {onPasarGlobal && !deshabilitado && (
                <button
                  type="button"
                  className="btn btn-link btn-sm align-baseline"
                  onClick={() => {
                    onPasarGlobal(rol.id);
                    // La línea desaparece: el foco va al desplegable, que
                    // ahora muestra ese rol.
                    requestAnimationFrame(() => principalRef.current?.focus());
                  }}
                >
                  Pasarlo a rol de la empresa
                  <span className="visually-hidden"> ({rol.name})</span>
                </button>
              )}
            </p>
          ))}
        </div>
      )}

      <FichasDeRoles
        id={`${idBase}-adicionales`}
        titulo="Roles adicionales"
        roles={adicionales.map((id) => ({ id, name: nombreDe(id) }))}
        contexto={enEmpresa}
        deshabilitado={deshabilitado}
        onQuitar={(rolId) => {
          onCambiar(
            asignados.filter((id) => id !== rolId),
            sinPrincipal,
          );
          anunciar(`Rol ${nombreDe(rolId)} quitado${enEmpresa}; sin guardar.`);
        }}
        focoAlVaciar={() => anadirRef.current ?? principalRef.current}
      />

      {/* Solo con un rol principal: el segundo se añade a propósito, no
          como atajo para elegir el primero. */}
      {!deshabilitado && principal !== undefined && (
        <AnadirRol
          idBase={idBase}
          botonRef={anadirRef}
          textoBoton="Añadir otro rol"
          etiqueta={`Otro rol${enEmpresa}`}
          opciones={opciones.filter((rol) => !manuales.includes(rol.id))}
          onAnadir={(rolId) => {
            onCambiar([...manuales, rolId, ...deCargo], false);
            anunciar(
              `Rol ${nombreDe(rolId)} añadido${enEmpresa}; sin guardar.`,
            );
          }}
          focoTrasAnadir={(rolId) => fichaDeRol(contenedor.current, rolId)}
        />
      )}

      {/* El de cargo lo pone el organigrama: se ve, no se elige. */}
      {deCargo.length > 0 && (
        <p className="mz-small mz-faint mb-0">
          Por su cargo en el organigrama:{" "}
          {deCargo.map((id) => nombreDe(id)).join(", ")}.
        </p>
      )}
    </div>
  );
}
