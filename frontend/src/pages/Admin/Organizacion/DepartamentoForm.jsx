import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  departamentosService,
  empleadosService,
} from "../../../api/organizacionService";
import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Organizacion.css";

const VACIO = {
  nombre: "",
  codigo: "",
  descripcion: "",
  responsable: "",
  activo: true,
};

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
        }),
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
    <div>
      <div className="mz-view-head">
        <div>
          <h2>{esEdicion ? "Editar departamento" : "Nuevo departamento"}</h2>
          <p className="mz-desc">
            Un área de la empresa, con el código que la identifica y la persona
            que responde por ella.
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <section className="mz-card organizacion-ficha">
        <div className="mz-card-head">
          <h3>Datos del departamento</h3>
        </div>
        <form onSubmit={handleSubmit} className="mz-card-body">
          <div className="mz-field-grid">
            <div className="mz-field">
              <label htmlFor="nombre">Nombre</label>
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
            <div className="mz-field">
              <label htmlFor="codigo">Código</label>
              <input
                id="codigo"
                className="form-control text-uppercase"
                required
                maxLength={20}
                value={valores.codigo}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("codigo", event.target.value)}
              />
              <div className="form-text">
                Aparece impreso en la etiqueta de cada activo del área.
              </div>
            </div>
            <div className="mz-field mz-field--full">
              <label htmlFor="descripcion">Descripción</label>
              <textarea
                id="descripcion"
                className="form-control"
                rows={2}
                value={valores.descripcion}
                disabled={!puedeEditar}
                onChange={(event) =>
                  actualizar("descripcion", event.target.value)
                }
              />
            </div>
            <div className="mz-field">
              <label htmlFor="responsable">Responsable del área</label>
              <select
                id="responsable"
                className="form-select"
                value={valores.responsable}
                disabled={!puedeEditar}
                onChange={(event) =>
                  actualizar("responsable", event.target.value)
                }
              >
                <option value="">Sin responsable asignado</option>
                {empleados.map((empleado) => (
                  <option key={empleado.id} value={empleado.id}>
                    {empleado.nombre_completo}
                  </option>
                ))}
              </select>
            </div>
            <div className="mz-field--full">
              <div className="form-check">
                <input
                  id="activo"
                  type="checkbox"
                  className="form-check-input"
                  checked={valores.activo}
                  disabled={!puedeEditar}
                  onChange={(event) =>
                    actualizar("activo", event.target.checked)
                  }
                />
                <label className="form-check-label" htmlFor="activo">
                  Departamento activo
                </label>
              </div>
            </div>
          </div>

          <div className="mz-actions justify-content-end mt-3">
            <button
              type="button"
              className="btn btn-cancelar"
              onClick={() => navigate("/admin/organizacion/departamentos")}
            >
              Volver
            </button>
            {puedeEditar && (
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSaving}
              >
                {isSaving ? "Guardando…" : "Guardar"}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
