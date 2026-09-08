import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { departamentosService, empleadosService } from "../../../api/organizacionService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Organizacion.css";

const VACIO = {
  nombres: "",
  apellidos: "",
  codigo_empleado: "",
  correo: "",
  telefono: "",
  cargo: "",
  departamento: "",
  activo: true,
};

export function EmpleadoForm() {
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const navigate = useNavigate();
  const puedeEditar = usePermission("organizacion.editar");

  const [valores, setValores] = useState(VACIO);
  const [departamentos, setDepartamentos] = useState([]);
  const [totalActivos, setTotalActivos] = useState(0);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    departamentosService
      .list({ activo: "true", page_size: 100 })
      .then((datos) => setDepartamentos(datos.results ?? datos))
      .catch(() => setDepartamentos([]));
  }, []);

  useEffect(() => {
    if (!esEdicion) return;
    empleadosService
      .get(id)
      .then((datos) => {
        setValores({
          nombres: datos.nombres,
          apellidos: datos.apellidos,
          codigo_empleado: datos.codigo_empleado,
          correo: datos.correo || "",
          telefono: datos.telefono || "",
          cargo: datos.cargo || "",
          departamento: datos.departamento,
          activo: datos.activo,
        });
        setTotalActivos(datos.total_activos ?? 0);
      })
      .catch(() => setError("No se pudo cargar el empleado."));
  }, [id, esEdicion]);

  function actualizar(campo, valor) {
    setValores((actuales) => ({ ...actuales, [campo]: valor }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      if (esEdicion) {
        await empleadosService.update(id, valores);
      } else {
        await empleadosService.create(valores);
      }
      navigate("/admin/organizacion/empleados");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el empleado."));
    } finally {
      setIsSaving(false);
    }
  }

  // El backend rechaza desactivar a quien aún custodia equipos; avisarlo aquí
  // evita que el usuario descubra la regla recién al guardar.
  const bloqueadoPorCustodia = esEdicion && valores.activo === false && totalActivos > 0;

  return (
    <div className="organizacion-page">
      <Breadcrumbs
        items={[
          { label: "Administración" },
          { label: "Empleados", path: "/admin/organizacion/empleados" },
          { label: esEdicion ? "Editar" : "Nuevo" },
        ]}
      />
      <h2>{esEdicion ? "Editar empleado" : "Nuevo empleado"}</h2>

      {error && <div className="alert alert-danger">{error}</div>}
      {bloqueadoPorCustodia && (
        <div className="alert alert-warning">
          Este empleado custodia {totalActivos} activo(s). Reasígnelos antes de desactivarlo.
        </div>
      )}

      <form onSubmit={handleSubmit} className="organizacion-form">
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label" htmlFor="nombres">
              Nombres
            </label>
            <input
              id="nombres"
              className="form-control"
              required
              maxLength={120}
              value={valores.nombres}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("nombres", event.target.value)}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="apellidos">
              Apellidos
            </label>
            <input
              id="apellidos"
              className="form-control"
              required
              maxLength={120}
              value={valores.apellidos}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("apellidos", event.target.value)}
            />
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="codigo">
              Código de empleado
            </label>
            <input
              id="codigo"
              className="form-control text-uppercase font-monospace"
              maxLength={30}
              placeholder={esEdicion ? "" : "Se genera solo (EMP-0001)"}
              value={valores.codigo_empleado}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("codigo_empleado", event.target.value)}
            />
            <div className="form-text">
              Identificador interno. Es el que se usa en la carga masiva de activos. Déjelo vacío
              para que el sistema lo genere.
            </div>
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="correo">
              Correo
            </label>
            <input
              id="correo"
              type="email"
              className="form-control"
              value={valores.correo}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("correo", event.target.value)}
            />
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="telefono">
              Teléfono
            </label>
            <input
              id="telefono"
              className="form-control"
              maxLength={30}
              value={valores.telefono}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("telefono", event.target.value)}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="cargo">
              Cargo
            </label>
            <input
              id="cargo"
              className="form-control"
              maxLength={120}
              value={valores.cargo}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("cargo", event.target.value)}
            />
          </div>
          <div className="col-md-6">
            <label className="form-label" htmlFor="departamento">
              Departamento
            </label>
            <select
              id="departamento"
              className="form-select"
              required
              value={valores.departamento}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("departamento", event.target.value)}
            >
              <option value="">Seleccione un departamento</option>
              {departamentos.map((departamento) => (
                <option key={departamento.id} value={departamento.id}>
                  {departamento.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12">
            <div className="form-check">
              <input
                id="activo"
                type="checkbox"
                className="form-check-input"
                checked={valores.activo}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("activo", event.target.checked)}
              />
              <label className="form-check-label" htmlFor="activo">
                Empleado activo
              </label>
            </div>
            {esEdicion && totalActivos > 0 && (
              <div className="form-text">
                Custodia actualmente {totalActivos} activo(s).
              </div>
            )}
          </div>
        </div>

        <div className="d-flex gap-2 mt-4">
          {puedeEditar && (
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              {isSaving ? "Guardando…" : "Guardar"}
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => navigate("/admin/organizacion/empleados")}
          >
            Volver
          </button>
        </div>
      </form>
    </div>
  );
}
