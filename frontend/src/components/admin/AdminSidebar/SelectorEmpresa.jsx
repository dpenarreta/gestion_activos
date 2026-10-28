import { useEffect, useState } from "react";

import { getEmpresaActiva, setEmpresaActiva } from "../../../api/client";
import { useAlCambiarConfiguracion } from "../../../api/cambiosDeConfiguracion";
import { empresasService } from "../../../api/empresasService";
import { Icon } from "../../common/Icon/Icon";

/**
 * En qué empresa se está trabajando.
 *
 * Se pregunta una sola vez, en el layout: la barra superior la muestra y la
 * cambia (el menú lateral dice el módulo). Saberlo antes de navegar evita el
 * error de mirar el inventario equivocado durante un rato.
 */
/** Si el sistema trabaja con varias empresas (23/10/2026: por defecto, con
 * una sola). */
export function useMultiempresa() {
  const [multiempresa, setMultiempresa] = useState(false);
  useEffect(() => {
    let vigente = true;
    Promise.resolve()
      .then(() => empresasService.mias())
      .then((datos) => vigente && setMultiempresa(Boolean(datos?.multiempresa)))
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, []);
  return multiempresa;
}

export function useMisEmpresas() {
  const [empresas, setEmpresas] = useState([]);
  const [activa, setActiva] = useState(null);
  const [multiempresa, setMultiempresa] = useState(false);

  const [vuelta, setVuelta] = useState(0);
  // Editada una empresa (nombre, color), la barra superior lo muestra ya.
  useAlCambiarConfiguracion(["empresas"], () => setVuelta((v) => v + 1));

  useEffect(() => {
    empresasService
      .mias()
      .then((datos) => {
        setEmpresas(datos.empresas);
        setActiva(datos.activa);
        setMultiempresa(Boolean(datos.multiempresa));
        // El backend manda: si la cabecera pedía una empresa que ya no es
        // suya, lo que se está viendo es otra y hay que decirlo.
        if (datos.activa && String(datos.activa.id) !== getEmpresaActiva()) {
          setEmpresaActiva(datos.activa.id);
        }
      })
      .catch(() => setEmpresas([]));
  }, [vuelta]);

  return { empresas, activa, multiempresa };
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
 * Con una sola empresa queda su nombre, sin desplegable: saber dónde se está
 * no es opcional, pero un selector de un elemento no elige.
 */
export function SelectorEmpresa({ empresas, activa }) {
  if (empresas.length === 0) return null;
  if (empresas.length === 1) {
    return (
      <div className="mz-switcher mz-switcher--fija" title="Empresa">
        <Icon name="building" className="mz-switcher__icono" />
        <span>{conRol(activa ?? empresas[0])}</span>
      </div>
    );
  }

  function cambiar(evento) {
    const id = evento.target.value;
    if (!id || id === String(activa?.id)) return;
    setEmpresaActiva(id);
    window.location.reload();
  }

  return (
    // En el teléfono solo se ve el ícono: el globo dice qué empresa está
    // activa (auditoría UX/UI, fase 3).
    <div
      className="mz-switcher mz-switcher--select"
      title={activa ? `Empresa: ${conRol(activa)}` : "Empresa"}
    >
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
