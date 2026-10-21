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
  nombres: "",
  apellidos: "",
  codigo_empleado: "",
  correo: "",
  telefono: "",
  cargo: "",
  departamento: "",
  activo: true,
  password: "",
};

export function EmpleadoForm() {
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const navigate = useNavigate();
  const puedeEditar = usePermission("organizacion.editar");

  const [valores, setValores] = useState(VACIO);
  const [departamentos, setDepartamentos] = useState([]);
  const [totalActivos, setTotalActivos] = useState(0);
  // Todo empleado tiene usuario (21/10/2026): al crearlo, o al completar uno
  // que no lo tenía, se crea su cuenta con el correo institucional.
  const [usuario, setUsuario] = useState(null);
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
          password: "",
        });
        setUsuario(
          datos.usuario
            ? { id: datos.usuario, username: datos.usuario_username }
            : null,
        );
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
    const { password, ...resto } = valores;
    const cuerpo = sinUsuario && password ? { ...resto, password } : resto;
    try {
      if (esEdicion) {
        await empleadosService.update(id, cuerpo);
      } else {
        await empleadosService.create(cuerpo);
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
  const bloqueadoPorCustodia =
    esEdicion && valores.activo === false && totalActivos > 0;
  const sinUsuario = !esEdicion || !usuario;

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>{esEdicion ? "Editar empleado" : "Nuevo empleado"}</h2>
          <p className="mz-desc">
            Una persona de la empresa, con su usuario del sistema, los equipos
            que tiene a su cargo y el departamento al que pertenece.
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {esEdicion && !usuario && valores.nombres && (
        <div className="mz-alert mz-alert--warn" role="status">
          <Icon name="person-exclamation" />
          Este empleado no tiene usuario. Escriba su correo institucional (y una
          contraseña inicial si la cuenta es nueva) para poder guardarlo.
        </div>
      )}
      {bloqueadoPorCustodia && (
        <div className="mz-alert mz-alert--warn" role="status">
          <Icon name="exclamation-triangle" />
          Este empleado custodia {totalActivos} activo(s). Reasígnelos antes de
          desactivarlo.
        </div>
      )}

      <section className="mz-card organizacion-ficha">
        <div className="mz-card-head">
          <h3>Datos del empleado</h3>
        </div>
        <form onSubmit={handleSubmit} className="mz-card-body">
          <div className="mz-field-grid">
            <div className="mz-field">
              <label htmlFor="nombres">Nombres</label>
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
            <div className="mz-field">
              <label htmlFor="apellidos">Apellidos</label>
              <input
                id="apellidos"
                className="form-control"
                required
                maxLength={120}
                value={valores.apellidos}
                disabled={!puedeEditar}
                onChange={(event) =>
                  actualizar("apellidos", event.target.value)
                }
              />
            </div>
            <div className="mz-field">
              <label htmlFor="codigo">Código de empleado</label>
              <input
                id="codigo"
                className="form-control text-uppercase font-monospace"
                maxLength={30}
                placeholder={esEdicion ? "" : "Se genera solo (EMP-0001)"}
                value={valores.codigo_empleado}
                disabled={!puedeEditar}
                onChange={(event) =>
                  actualizar("codigo_empleado", event.target.value)
                }
              />
              <div className="form-text">
                Identificador interno. Es el que se usa en la carga masiva de
                activos. Déjelo vacío para que el sistema lo genere.
              </div>
            </div>
            <div className="mz-field">
              <label htmlFor="correo">Correo institucional</label>
              <input
                id="correo"
                type="email"
                className="form-control"
                required
                placeholder="nombre.apellido@grupolaar.com"
                value={valores.correo}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("correo", event.target.value)}
              />
              <div className="form-text">
                {usuario ? (
                  <>
                    Usuario: <strong>{usuario.username}</strong>. Se administra
                    en Configuración → Usuarios y roles.
                  </>
                ) : (
                  "Con él se crea su usuario; si ya existe una cuenta con ese correo, se ata a ella."
                )}
              </div>
            </div>
            {sinUsuario && (
              <div className="mz-field">
                <label htmlFor="password">Contraseña inicial</label>
                <input
                  id="password"
                  type="password"
                  className="form-control"
                  autoComplete="new-password"
                  value={valores.password}
                  disabled={!puedeEditar}
                  onChange={(event) =>
                    actualizar("password", event.target.value)
                  }
                />
                <div className="form-text">
                  Solo si la cuenta es nueva. La persona la cambia al entrar por
                  primera vez; el rol se asigna en Usuarios y roles.
                </div>
              </div>
            )}
            <div className="mz-field">
              <label htmlFor="telefono">Teléfono</label>
              <input
                id="telefono"
                className="form-control"
                maxLength={30}
                value={valores.telefono}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("telefono", event.target.value)}
              />
            </div>
            <div className="mz-field">
              <label htmlFor="cargo">Cargo</label>
              <input
                id="cargo"
                className="form-control"
                maxLength={120}
                value={valores.cargo}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("cargo", event.target.value)}
              />
            </div>
            <div className="mz-field">
              <label htmlFor="departamento">Departamento</label>
              <select
                id="departamento"
                className="form-select"
                required
                value={valores.departamento}
                disabled={!puedeEditar}
                onChange={(event) =>
                  actualizar("departamento", event.target.value)
                }
              >
                <option value="">Seleccione un departamento</option>
                {departamentos.map((departamento) => (
                  <option key={departamento.id} value={departamento.id}>
                    {departamento.nombre}
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

          <div className="mz-actions justify-content-end mt-3">
            <button
              type="button"
              className="btn btn-cancelar"
              onClick={() => navigate("/admin/organizacion/empleados")}
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
