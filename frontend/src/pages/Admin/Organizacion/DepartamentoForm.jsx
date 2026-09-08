import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { departamentosService, empleadosService } from "../../../api/organizacionService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Organizacion.css";

const VACIO = { nombre: "", codigo: "", descripcion: "", responsable: "", activo: true };

export function DepartamentoForm() {
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const navigate = useNavigate();
  const puedeEditar = usePermission("organizacion.editar");

  const [valores, setValores] = useState(VACIO);
  const [empleados, setEmpleados] = useState([]);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    // Solo empleados vigentes: nombrar responsable a alguien dado de baja
    // dejaría el área sin interlocutor real.
    empleadosService
      .list({ activo: "true", page_size: 100 })
      .then((datos) => setEmpleados(datos.results ?? datos))
      .catch(() => setEmpleados([]));
  }, []);

  useEffect(() => {
    if (!esEdicion) return;
    departamentosService
      .get(id)
      .then((datos) =>
        setValores({
          nombre: datos.nombre,
          codigo: datos.codigo,
          descripcion: datos.descripcion || "",
          responsable: datos.responsable || "",
          activo: datos.activo,
        })
      )
      .catch(() => setError("No se pudo cargar el departamento."));
  }, [id, esEdicion]);

  function actualizar(campo, valor) {
    setValores((actuales) => ({ ...actuales, [campo]: valor }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const payload = { ...valores, responsable: valores.responsable || null };
      if (esEdicion) {
        await departamentosService.update(id, payload);
      } else {
        await departamentosService.create(payload);
      }
      navigate("/admin/organizacion/departamentos");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el departamento."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="organizacion-page">
      <Breadcrumbs
        items={[
          { label: "Administración" },
          { label: "Departamentos", path: "/admin/organizacion/departamentos" },
          { label: esEdicion ? "Editar" : "Nuevo" },
        ]}
      />
      <h2>{esEdicion ? "Editar departamento" : "Nuevo departamento"}</h2>

      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={handleSubmit} className="organizacion-form">
        <div className="row g-3">
          <div className="col-md-8">
            <label className="form-label" htmlFor="nombre">
              Nombre
            </label>
            <input
              id="nombre"
              className="form-control"
              required
              maxLength={120}
              value={valores.nombre}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("nombre", event.target.value)}
            />
          </div>
          <div className="col-md-4">
            <label className="form-label" htmlFor="codigo">
              Código
            </label>
            <input
              id="codigo"
              className="form-control text-uppercase"
              required
              maxLength={20}
              value={valores.codigo}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("codigo", event.target.value)}
            />
            <div className="form-text">Aparece impreso en la etiqueta de cada activo del área.</div>
          </div>
          <div className="col-12">
            <label className="form-label" htmlFor="descripcion">
              Descripción
            </label>
            <textarea
              id="descripcion"
              className="form-control"
              rows={2}
              value={valores.descripcion}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("descripcion", event.target.value)}
            />
          </div>
          <div className="col-md-8">
            <label className="form-label" htmlFor="responsable">
              Responsable del área
            </label>
            <select
              id="responsable"
              className="form-select"
              value={valores.responsable}
              disabled={!puedeEditar}
              onChange={(event) => actualizar("responsable", event.target.value)}
            >
              <option value="">Sin responsable asignado</option>
              {empleados.map((empleado) => (
                <option key={empleado.id} value={empleado.id}>
                  {empleado.nombre_completo}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-4 d-flex align-items-end">
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
                Departamento activo
              </label>
            </div>
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
            onClick={() => navigate("/admin/organizacion/departamentos")}
          >
            Volver
          </button>
        </div>
      </form>
    </div>
  );
}
