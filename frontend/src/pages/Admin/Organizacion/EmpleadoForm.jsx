import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  departamentosService,
  empleadosService,
} from "../../../api/organizacionService";
import {
  Campo,
  enfocarPrimerError,
  LeyendaObligatorios,
} from "../../../components/common/Campo/Campo";
import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";
import {
  hayErroresGenerales,
  erroresPorCampo,
  mensajeDeError,
} from "../../../utils/errores";
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
// Un error del servidor sobre uno de estos campos va bajo el campo; sobre
// otra cosa, en el aviso de arriba con el detalle completo.
const CAMPOS_DEL_FORMULARIO = new Set(Object.keys(VACIO));

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
  const [erroresCampo, setErroresCampo] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const formRef = useRef(null);

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
    // Lo corregido deja de marcarse como error.
    setErroresCampo((actuales) =>
      actuales[campo] ? { ...actuales, [campo]: undefined } : actuales,
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setErroresCampo({});
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
      // Cada error bajo su campo y, arriba, un aviso general; si alguno no es
      // de un campo del formulario, el aviso lleva el detalle completo
      // (auditoría UX/UI, fase 2, 28/10/2026).
      const porCampo = erroresPorCampo(err);
      const claves = Object.keys(porCampo);
      setErroresCampo(porCampo);
      setError(
        claves.length > 0 &&
          claves.every((clave) => CAMPOS_DEL_FORMULARIO.has(clave)) &&
          !hayErroresGenerales(err)
          ? "Revise los campos marcados."
          : mensajeDeError(err, "No se pudo guardar el empleado."),
      );
      enfocarPrimerError(formRef.current);
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
        <form ref={formRef} onSubmit={handleSubmit} className="mz-card-body">
          {/* Dentro del formulario: tras un error, el foco puede ir aquí si
              ningún campo quedó marcado. */}
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {/* Obligatorios marcados y cada error del servidor bajo su campo
              (auditoría UX/UI, fase 2, 28/10/2026). */}
          <div className="mz-field-grid">
            <Campo
              id="nombres"
              etiqueta="Nombres"
              obligatorio
              error={erroresCampo.nombres}
              className="mz-field"
            >
              <input
                className="form-control"
                maxLength={120}
                value={valores.nombres}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("nombres", event.target.value)}
              />
            </Campo>
            <Campo
              id="apellidos"
              etiqueta="Apellidos"
              obligatorio
              error={erroresCampo.apellidos}
              className="mz-field"
            >
              <input
                className="form-control"
                maxLength={120}
                value={valores.apellidos}
                disabled={!puedeEditar}
                onChange={(event) =>
                  actualizar("apellidos", event.target.value)
                }
              />
            </Campo>
            <Campo
              id="codigo"
              etiqueta="Código de empleado"
              ayuda="Identificador interno. Es el que se usa en la carga masiva de activos. Déjelo vacío para que el sistema lo genere."
              error={erroresCampo.codigo_empleado}
              className="mz-field"
            >
              <input
                className="form-control text-uppercase font-monospace"
                maxLength={30}
                placeholder={esEdicion ? "" : "Se genera solo (EMP-0001)"}
                value={valores.codigo_empleado}
                disabled={!puedeEditar}
                onChange={(event) =>
                  actualizar("codigo_empleado", event.target.value)
                }
              />
            </Campo>
            <Campo
              id="correo"
              etiqueta="Correo institucional"
              obligatorio
              ayuda={
                usuario ? (
                  <>
                    Usuario: <strong>{usuario.username}</strong>. Se administra
                    en Configuración → Usuarios y roles.
                  </>
                ) : (
                  "Con él se crea su usuario; si ya existe una cuenta con ese correo, se ata a ella."
                )
              }
              error={erroresCampo.correo}
              className="mz-field"
            >
              <input
                type="email"
                className="form-control"
                placeholder="nombre.apellido@grupolaar.com"
                value={valores.correo}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("correo", event.target.value)}
              />
            </Campo>
            {sinUsuario && (
              <Campo
                id="password"
                etiqueta="Contraseña inicial (opcional)"
                ayuda="Solo si la cuenta es nueva. Vacía, nace con la clave temporal; con una u otra, la persona la cambia al entrar por primera vez. El rol se asigna en Usuarios y roles."
                error={erroresCampo.password}
                className="mz-field"
              >
                <input
                  type="password"
                  className="form-control"
                  autoComplete="new-password"
                  value={valores.password}
                  disabled={!puedeEditar}
                  onChange={(event) =>
                    actualizar("password", event.target.value)
                  }
                />
              </Campo>
            )}
            <Campo
              id="telefono"
              etiqueta="Teléfono"
              error={erroresCampo.telefono}
              className="mz-field"
            >
              <input
                className="form-control"
                maxLength={30}
                value={valores.telefono}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("telefono", event.target.value)}
              />
            </Campo>
            <Campo
              id="cargo"
              etiqueta="Cargo"
              error={erroresCampo.cargo}
              className="mz-field"
            >
              <input
                className="form-control"
                maxLength={120}
                value={valores.cargo}
                disabled={!puedeEditar}
                onChange={(event) => actualizar("cargo", event.target.value)}
              />
            </Campo>
            <Campo
              id="departamento"
              etiqueta="Departamento"
              obligatorio
              error={erroresCampo.departamento}
              className="mz-field"
            >
              <select
                className="form-select"
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
            </Campo>
            <div className="mz-field--full">
              <div className="form-check">
                <input
                  id="activo"
                  type="checkbox"
                  className={`form-check-input${erroresCampo.activo ? " is-invalid" : ""}`}
                  checked={valores.activo}
                  disabled={!puedeEditar}
                  aria-invalid={erroresCampo.activo ? true : undefined}
                  aria-describedby={
                    erroresCampo.activo ? "activo-error" : undefined
                  }
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
              {erroresCampo.activo && (
                <div id="activo-error" className="mz-field-error">
                  {erroresCampo.activo}
                </div>
              )}
            </div>
          </div>

          <div className="mz-actions justify-content-between align-items-center mt-3">
            <LeyendaObligatorios />
            <div className="d-flex flex-wrap gap-2">
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
          </div>
        </form>
      </section>
    </div>
  );
}
