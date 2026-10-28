import { useCallback, useEffect, useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import { FilaDeEstado } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { nombreDeCargo } from "./organigrama";
import "./Institucional.css";
import { usePedirMotivo } from "../../components/common/PedirMotivo/PedirMotivo";

/**
 * Estructura → pestaña «Asignación de cargos»: quién ocupa cada cargo. Es el
 * mismo dato que cada persona elige en «Mi perfil»; desde aquí lo ajusta quien
 * administra el organigrama, y el último cambio es el que vale.
 *
 * Recibe el organigrama ya cargado por la página y avisa (`onAsignado`) para
 * que se recargue: así las plazas y vacantes de las otras pestañas quedan al
 * día.
 */
export function AsignacionCargos({ datos, onAsignado }) {
  const [buscar, setBuscar] = useState("");
  const [personas, setPersonas] = useState(null);
  const [error, setError] = useState(null);
  // El fallo al cargar la lista va en la tabla, con «Reintentar» (auditoría
  // UX/UI, fase 2, 28/10/2026).
  const [errorCarga, setErrorCarga] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [pedirMotivo, dialogoMotivo] = usePedirMotivo();

  const cargarPersonas = useCallback((texto) => {
    setErrorCarga(null);
    return institucionalService
      .asignaciones(texto)
      .then(setPersonas)
      .catch((err) =>
        setErrorCarga(
          mensajeDeError(err, "No se pudieron cargar las personas."),
        ),
      );
  }, []);

  // Al cambiar la búsqueda, «Cargando…» en vez de la lista anterior.
  const buscarPersonas = useCallback(() => {
    setPersonas(null);
    return cargarPersonas(buscar);
  }, [buscar, cargarPersonas]);

  useEffect(() => {
    const espera = setTimeout(buscarPersonas, 250);
    return () => clearTimeout(espera);
  }, [buscarPersonas]);

  async function asignar(persona, cargo) {
    setError(null);
    setAviso(null);
    const nombre = (datos?.cargos ?? []).find(
      (c) => String(c.id) === String(cargo),
    )?.nombre;
    const motivo = await pedirMotivo(
      cargo
        ? `${persona.nombre} pasa al cargo «${nombre ?? cargo}».`
        : `${persona.nombre} queda sin cargo.`,
    );
    if (!motivo) {
      // Sin motivo no se cambia: la lista vuelve a mostrar el cargo de antes.
      await cargarPersonas(buscar);
      return;
    }
    try {
      await institucionalService.asignar(persona.id, cargo, motivo);
      setAviso(
        cargo
          ? `${persona.nombre} quedó en su nuevo cargo.`
          : `${persona.nombre} quedó sin cargo.`,
      );
      await Promise.all([cargarPersonas(buscar), onAsignado?.()]);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo asignar el cargo."));
    }
  }

  const cargos = (datos?.cargos ?? []).filter((c) => c.activo);

  return (
    <div className="mz-stack">
      {dialogoMotivo}
      <p className="mz-faint mb-0">
        Quién ocupa cada cargo. Cada persona también puede elegir el suyo en «Mi
        perfil»: vale el último cambio.
      </p>

      <input
        type="search"
        className="form-control form-control-sm org-barra__buscar ms-0"
        placeholder="Buscar por nombre o correo"
        aria-label="Buscar por nombre o correo"
        value={buscar}
        onChange={(e) => setBuscar(e.target.value)}
      />

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check-circle" />
          {aviso}
        </div>
      )}
      {datos && cargos.length === 0 && (
        <p className="mz-faint">
          Todavía no hay cargos: créelos en la pestaña «Cargos» para poder
          asignarlos.
        </p>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Persona</th>
              <th>Correo</th>
              <th>Cargo</th>
            </tr>
          </thead>
          <tbody>
            {(personas ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td className="mz-small">{p.correo}</td>
                <td>
                  <select
                    className="form-select form-select-sm"
                    aria-label={`Cargo de ${p.nombre}`}
                    value={p.cargo?.id ?? ""}
                    disabled={cargos.length === 0}
                    onChange={(e) => asignar(p, e.target.value)}
                  >
                    <option value="">Sin cargo</option>
                    {cargos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {nombreDeCargo(c, datos.unidades, datos.cargos)}
                        {c.vacantes === 0 && c.id !== p.cargo?.id
                          ? " (sin vacantes)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            <FilaDeEstado
              columnas={3}
              cargando={personas === null}
              error={errorCarga}
              onReintentar={buscarPersonas}
              vacio={personas?.length === 0}
              textoVacio="Todavía no hay personas."
              hayFiltros={buscar.trim() !== ""}
              onLimpiarFiltros={() => setBuscar("")}
            />
          </tbody>
        </table>
      </div>
    </div>
  );
}
