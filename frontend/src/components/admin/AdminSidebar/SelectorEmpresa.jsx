import { useEffect, useState } from "react";

import { getEmpresaActiva, setEmpresaActiva } from "../../../api/client";
import { empresasService } from "../../../api/empresasService";
import { Icon } from "../../common/Icon/Icon";

/**
 * En qué empresa se está trabajando (debajo del logo, encima del menú).
 *
 * Cambiar de empresa cambia **de dónde salen los datos**, no una vista: el
 * inventario, los catálogos, el panel y los reportes pasan a ser los de la
 * otra. Por eso al cambiar se recarga la aplicación entera en vez de refrescar
 * la pantalla actual: media docena de pantallas tienen datos ya cargados en
 * memoria —listados, filtros, desplegables— y refrescar solo lo visible
 * dejaría los demás mostrando lo de la empresa anterior.
 *
 * Con una sola empresa no se dibuja nada: un selector de un elemento no elige,
 * solo ocupa sitio.
 */
export function SelectorEmpresa({ isCollapsed }) {
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

  function cambiar(evento) {
    const id = evento.target.value;
    if (!id || id === String(activa?.id)) return;
    setEmpresaActiva(id);
    window.location.reload();
  }

  if (empresas.length === 0) return null;

  if (isCollapsed) {
    // Contraído no cabe un desplegable, pero saber en qué empresa se está no
    // es opcional: se deja la inicial, con el nombre en el título.
    return (
      <div
        className="selector-empresa selector-empresa--contraido"
        title={activa?.nombre}
      >
        <span aria-hidden="true">{(activa?.codigo || "·").slice(0, 2)}</span>
        <span className="visually-hidden">{activa?.nombre}</span>
      </div>
    );
  }

  if (empresas.length === 1) {
    return (
      <div className="selector-empresa selector-empresa--unica">
        <Icon name="building" className="selector-empresa__icono" />
        <span>{activa?.nombre || empresas[0].nombre}</span>
      </div>
    );
  }

  return (
    <div className="selector-empresa">
      <label className="visually-hidden" htmlFor="selector-empresa">
        Empresa
      </label>
      <select
        id="selector-empresa"
        className="form-select form-select-sm"
        value={activa?.id ?? ""}
        onChange={cambiar}
      >
        {empresas.map((empresa) => (
          <option key={empresa.id} value={empresa.id}>
            {empresa.nombre}
          </option>
        ))}
      </select>
    </div>
  );
}
