import { useEffect, useState } from "react";

import { getEmpresaActiva, setEmpresaActiva } from "../../../api/client";
import { empresasService } from "../../../api/empresasService";
import { Icon } from "../../common/Icon/Icon";

/**
 * En qué empresa se está trabajando.
 *
 * Se pregunta una sola vez, en el layout, y se reparte a dos sitios —como en
 * la identidad base—: el menú lateral la *muestra* («Tablero activo», debajo
 * de la marca) y la barra superior la *cambia*. Saberlo antes de navegar evita
 * el error de mirar el inventario equivocado durante un rato.
 */
export function useMisEmpresas() {
  const [empresas, setEmpresas] = useState([]);
  const [activa, setActiva] = useState(null);

  useEffect(() => {
    empresasService
      .mias()
      .then((datos) => {
        setEmpresas(datos.empresas);
        setActiva(datos.activa);
        // El backend manda: si la cabecera pedía una empresa que ya no es
        // suya, lo que se está viendo es otra y hay que decirlo.
        if (datos.activa && String(datos.activa.id) !== getEmpresaActiva()) {
          setEmpresaActiva(datos.activa.id);
        }
      })
      .catch(() => setEmpresas([]));
  }, []);

  return { empresas, activa };
}

/**
 * El nombre con el rol que se ejerce en ella: la misma persona puede
 * administrar una empresa y solo consultar otra, y conviene saberlo antes de
 * cambiar (especificación de la Matriz, §15.1).
 */
function conRol(empresa) {
  return empresa.roles?.length
    ? `${empresa.nombre} — ${empresa.roles.join(", ")}`
    : empresa.nombre;
}

/** «Tablero activo» del menú lateral: solo dice dónde se está. */
export function EmpresaActiva({ empresas, activa, isCollapsed }) {
  if (empresas.length === 0) return null;
  const nombre = activa?.nombre || empresas[0].nombre;

  if (isCollapsed) {
    // Contraído no cabe el nombre, pero saber en qué empresa se está no es
    // opcional: se deja el código, con el nombre en el título.
    return (
      <div
        className="mz-active-company mz-active-company--contraida"
        title={nombre}
      >
        <strong aria-hidden="true">
          {(activa?.codigo || nombre).slice(0, 2)}
        </strong>
        <span className="visually-hidden">{nombre}</span>
      </div>
    );
  }

  const roles = (empresas.find((e) => e.id === activa?.id) ?? empresas[0])
    ?.roles;
  return (
    <div className="mz-active-company">
      <small>Tablero activo</small>
      <strong>{nombre}</strong>
      {roles?.length > 0 && (
        <span className="mz-active-company__rol">{roles.join(" · ")}</span>
      )}
    </div>
  );
}

/**
 * Cambio de empresa, en la barra superior.
 *
 * Cambiar de empresa cambia **de dónde salen los datos**, no una vista: el
 * inventario, los catálogos, el panel y los reportes pasan a ser los de la
 * otra. Por eso se recarga la aplicación entera en vez de refrescar la
 * pantalla actual: media docena de pantallas tienen datos ya cargados en
 * memoria —listados, filtros, desplegables— y refrescar solo lo visible
 * dejaría los demás mostrando lo de la empresa anterior.
 *
 * Es un `<select>` nativo dibujado como el selector de la identidad base: el
 * teclado, el lector de pantalla y el desplegable del teléfono vienen hechos.
 * Con una sola empresa no se dibuja: un selector de un elemento no elige.
 */
export function SelectorEmpresa({ empresas, activa }) {
  if (empresas.length < 2) return null;

  function cambiar(evento) {
    const id = evento.target.value;
    if (!id || id === String(activa?.id)) return;
    setEmpresaActiva(id);
    window.location.reload();
  }

  return (
    <div className="mz-switcher mz-switcher--select">
      <Icon name="building" className="mz-switcher__icono" />
      <label className="visually-hidden" htmlFor="selector-empresa">
        Empresa
      </label>
      <select id="selector-empresa" value={activa?.id ?? ""} onChange={cambiar}>
        {empresas.map((empresa) => (
          <option key={empresa.id} value={empresa.id}>
            {conRol(empresa)}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" className="mz-switcher__flecha" />
    </div>
  );
}
