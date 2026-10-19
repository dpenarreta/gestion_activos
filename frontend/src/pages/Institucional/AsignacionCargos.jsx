import { useCallback, useEffect, useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { nombreDeCargo } from "./organigrama";
import "./Institucional.css";

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
  const [aviso, setAviso] = useState(null);

  const cargarPersonas = useCallback(
    (texto) =>
      institucionalService
        .asignaciones(texto)
        .then(setPersonas)
        .catch((err) =>
          setError(mensajeDeError(err, "No se pudieron cargar las personas.")),
        ),
    [],
  );

  useEffect(() => {
    const espera = setTimeout(() => cargarPersonas(buscar), 250);
    return () => clearTimeout(espera);
  }, [buscar, cargarPersonas]);

  async function asignar(persona, cargo) {
    setError(null);
    setAviso(null);
    try {
      await institucionalService.asignar(persona.id, cargo);
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
            {personas?.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={3}>Ninguna persona coincide</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
