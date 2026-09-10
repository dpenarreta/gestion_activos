import { useEffect, useState } from "react";

import { adminUsersService } from "../../../api/adminUsersService";
import { empresasService } from "../../../api/empresasService";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Empresas.css";

/**
 * En qué empresas trabaja una cuenta, dentro de su ficha.
 *
 * Va aquí y no en la ficha de la empresa porque la pregunta que se hace de
 * verdad es «qué ve esta persona», no «quiénes ven esta empresa»: el alta de
 * un empleado y la revisión de un acceso se miran usuario por usuario.
 *
 * Se guarda con su propio botón, aparte del de los datos del perfil: repartir
 * accesos exige `empresas.asignar` y corregir un apellido exige
 * `usuarios.editar`; con un único guardado, quien solo tiene uno de los dos
 * permisos no podría hacer nada.
 */
export function AsignacionEmpresas({ usuarioId }) {
  const puedeVer = usePermission("empresas.ver");
  const puedeAsignar = usePermission("empresas.asignar");

  const [empresas, setEmpresas] = useState([]);
  const [seleccionadas, setSeleccionadas] = useState([]);
  const [predeterminada, setPredeterminada] = useState(null);
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!puedeVer || !usuarioId) return;
    Promise.all([
      empresasService.list({ page_size: 100 }),
      adminUsersService.get(usuarioId),
    ])
      .then(([listado, usuario]) => {
        setEmpresas(listado.results ?? []);
        const asignadas = usuario.empresas ?? [];
        setSeleccionadas(asignadas.map((empresa) => empresa.id));
        setPredeterminada(
          asignadas.find((empresa) => empresa.es_predeterminada)?.id ?? null,
        );
      })
      .catch(() => setError("No se pudieron cargar las empresas."));
  }, [usuarioId, puedeVer]);

  function alternar(empresaId) {
    setMensaje(null);
    setSeleccionadas((actuales) => {
      const siguiente = actuales.includes(empresaId)
        ? actuales.filter((id) => id !== empresaId)
        : [...actuales, empresaId];
      // Quitar la que estaba marcada como predeterminada dejaría al usuario
      // entrando cada día en una empresa que ya no puede ver.
      if (!siguiente.includes(empresaId) && predeterminada === empresaId) {
        setPredeterminada(siguiente[0] ?? null);
      }
      if (predeterminada === null && siguiente.length > 0) {
        setPredeterminada(siguiente[0]);
      }
      return siguiente;
    });
  }

  async function guardar() {
    setIsSaving(true);
    setError(null);
    setMensaje(null);
    try {
      await adminUsersService.assignEmpresas(
        usuarioId,
        seleccionadas,
        seleccionadas.includes(predeterminada) ? predeterminada : null,
      );
      setMensaje("Empresas actualizadas.");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudieron asignar las empresas."));
    } finally {
      setIsSaving(false);
    }
  }

  if (!puedeVer) return null;

  return (
    <div className="empresas-asignacion mt-4">
      <h5>Empresas</h5>
      <p className="text-muted">
        Solo verá la información de las empresas marcadas. La predeterminada es
        la que se abre al entrar.
      </p>

      {error && <div className="alert alert-danger">{error}</div>}
      {mensaje && <div className="alert alert-success">{mensaje}</div>}

      {empresas.length === 1 && (
        <div className="alert alert-info">
          {/* Con una sola empresa no hay de quién aislarse, y el backend deja
              trabajar en ella aunque nadie haya marcado nada: decirlo aquí
              evita que se lea como un permiso que falta. */}
          Hay una sola empresa: todas las cuentas trabajan en ella aunque no se
          marque nada. La asignación empieza a decidir en cuanto exista una
          segunda.
        </div>
      )}

      <table className="table table-sm align-middle">
        <thead>
          <tr>
            <th>Empresa</th>
            <th className="text-center">Asignada</th>
            <th className="text-center">Predeterminada</th>
          </tr>
        </thead>
        <tbody>
          {empresas.map((empresa) => (
            <tr key={empresa.id}>
              <td>
                {empresa.nombre}
                {!empresa.activa && (
                  <span className="badge text-bg-secondary ms-2">Inactiva</span>
                )}
              </td>
              <td className="text-center">
                <input
                  type="checkbox"
                  className="form-check-input"
                  aria-label={`Asignar ${empresa.nombre}`}
                  checked={seleccionadas.includes(empresa.id)}
                  disabled={!puedeAsignar}
                  onChange={() => alternar(empresa.id)}
                />
              </td>
              <td className="text-center">
                <input
                  type="radio"
                  name="empresa-predeterminada"
                  className="form-check-input"
                  aria-label={`${empresa.nombre} como predeterminada`}
                  checked={predeterminada === empresa.id}
                  disabled={
                    !puedeAsignar || !seleccionadas.includes(empresa.id)
                  }
                  onChange={() => setPredeterminada(empresa.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {puedeAsignar && (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={isSaving}
          onClick={guardar}
        >
          {isSaving ? "Guardando…" : "Guardar empresas"}
        </button>
      )}
    </div>
  );
}
