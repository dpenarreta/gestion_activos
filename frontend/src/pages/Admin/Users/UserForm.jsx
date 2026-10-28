import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { adminUsersService } from "../../../api/adminUsersService";
import {
  Campo,
  enfocarPrimerError,
  LeyendaObligatorios,
} from "../../../components/common/Campo/Campo";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { ReglasContrasena } from "../../../components/common/ReglasContrasena/ReglasContrasena";
import { Icon } from "../../../components/common/Icon/Icon";
import { useUnsavedChanges } from "../../../context/UnsavedChangesContext";
import { usePermission } from "../../../hooks/usePermission";
import {
  hayErroresGenerales,
  erroresPorCampo,
  mensajeDeError,
} from "../../../utils/errores";
import { baseDeUsername } from "../../../utils/nomenclatura";
import { AsignacionEmpresas } from "../Empresas/AsignacionEmpresas";
import { SeleccionEmpresaYRol } from "../Empresas/SeleccionEmpresaYRol";
import { useMultiempresa } from "../../../components/admin/AdminSidebar/SelectorEmpresa";

const EMPTY_FORM = {
  username: "",
  email: "",
  password: "",
  first_name: "",
  last_name: "",
  codigo_empleado: "",
};
// Los campos que el formulario muestra: un error del servidor sobre uno de
// ellos va bajo el campo; uno sobre otra cosa (p. ej. `empresas`), arriba.
const CAMPOS_DEL_FORMULARIO = new Set(Object.keys(EMPTY_FORM));
const EMPTY_ALTA = { empresaId: null, rolId: null };
/**
 * Qué se hizo de verdad al restablecer, en vez de «La acción se ejecutó
 * correctamente»: quien lo pidió necesita saber si el enlace salió o si las
 * sesiones se cerraron (revisión final UX/UI, 28/10/2026).
 */
function textoDelRestablecimiento(opciones) {
  const hechos = [];
  if (opciones.send_link) hechos.push("se envió el enlace de restablecimiento");
  if (opciones.force_change_on_next_login) {
    hechos.push("deberá cambiar la contraseña en su próximo ingreso");
  }
  if (opciones.revoke_sessions) hechos.push("se cerraron todas sus sesiones");
  if (hechos.length === 0) return "Restablecimiento aplicado.";
  const lista =
    hechos.length === 1
      ? hechos[0]
      : `${hechos.slice(0, -1).join(", ")} y ${hechos[hechos.length - 1]}`;
  return `Listo: ${lista}.`;
}

const EMPTY_RESET_OPTIONS = {
  send_link: false,
  force_change_on_next_login: false,
  revoke_sessions: false,
};

export function UserForm() {
  const puedeEditarCodigo = usePermission("roles_pago.habilitar");
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const canResetPassword = usePermission("usuarios.restablecer_password");
  const puedeAsignarEmpresas = usePermission("empresas.asignar");
  const multiempresa = useMultiempresa();
  const { setIsDirty, guardedNavigate } = useUnsavedChanges();
  // Con qué empresa y rol nace la cuenta. Solo se pregunta al crearla: en
  // la ficha ya está el bloque completo, con todas sus empresas.
  const [alta, setAlta] = useState(EMPTY_ALTA);
  const [form, setForm] = useState(EMPTY_FORM);
  // Lo último cargado o guardado: con él se sabe si hay cambios sin guardar.
  const [original, setOriginal] = useState(EMPTY_FORM);
  // Con qué nombre entrará: se enseña mientras se escribe, para que no haya
  // que descubrirlo después de guardar.
  const usernamePropuesto = baseDeUsername(form.first_name, form.last_name);
  const [error, setError] = useState(null);
  const [erroresCampo, setErroresCampo] = useState({});
  const [mensajeDatos, setMensajeDatos] = useState(null);
  const [accesosSinGuardar, setAccesosSinGuardar] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [resetOptions, setResetOptions] = useState(EMPTY_RESET_OPTIONS);
  const [isConfirmResetOpen, setIsConfirmResetOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState(null);
  const [resetError, setResetError] = useState(null);
  const formRef = useRef(null);

  useEffect(() => {
    if (!isEditing) {
      return;
    }
    setIsLoading(true);
    adminUsersService
      .get(id)
      .then((data) => {
        const cargado = {
          username: data.username,
          email: data.email,
          password: "",
          first_name: data.first_name,
          last_name: data.last_name,
          codigo_empleado: data.codigo_empleado ?? "",
        };
        setForm(cargado);
        setOriginal(cargado);
      })
      .catch(() => setError("No se pudo cargar el usuario."))
      .finally(() => setIsLoading(false));
  }, [id, isEditing]);

  // Cada tarjeta guarda por separado, así que se avisa al salir si cualquiera
  // de las dos tiene cambios pendientes (auditoría UX/UI, fase 2, 28/10/2026).
  // El restablecimiento de contraseña no cuenta: es una acción, no un dato.
  const datosSinGuardar =
    Object.keys(EMPTY_FORM).some((campo) => form[campo] !== original[campo]) ||
    (!isEditing && (alta.empresaId !== null || alta.rolId !== null));

  useEffect(() => {
    setIsDirty(datosSinGuardar || accesosSinGuardar);
  }, [datosSinGuardar, accesosSinGuardar, setIsDirty]);

  useEffect(() => () => setIsDirty(false), [setIsDirty]);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm({ ...form, [name]: value });
    setMensajeDatos(null);
    if (erroresCampo[name]) {
      setErroresCampo({ ...erroresCampo, [name]: undefined });
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setErroresCampo({});
    setMensajeDatos(null);
    setIsLoading(true);
    try {
      if (isEditing) {
        const {
          username,
          email,
          first_name: firstName,
          last_name: lastName,
        } = form;
        await adminUsersService.update(id, {
          username,
          email,
          first_name: firstName,
          last_name: lastName,
          codigo_empleado: form.codigo_empleado.trim(),
        });
        setOriginal(form);
        setMensajeDatos("Datos guardados.");
      } else {
        // Al crear, se pasa a la URL de edición del usuario recién creado
        // (`replace` para que "atrás" no vuelva al formulario de alta ya
        // resuelto) — nunca se sale hacia el listado.
        // Sin `username`: lo compone el backend a partir del nombre.
        const created = await adminUsersService.create({
          email: form.email,
          password: form.password,
          first_name: form.first_name,
          last_name: form.last_name,
          ...(form.codigo_empleado.trim()
            ? { codigo_empleado: form.codigo_empleado.trim() }
            : {}),
          ...(puedeAsignarEmpresas && alta.empresaId && alta.rolId
            ? {
                empresas: [
                  {
                    empresa_id: alta.empresaId,
                    roles: [alta.rolId],
                    es_predeterminada: true,
                  },
                ],
              }
            : {}),
        });
        // Ya guardado: no queda nada que perder al pasar a su ficha.
        setOriginal(form);
        setAlta(EMPTY_ALTA);
        navigate(`/admin/users/${created.id}`, { replace: true });
      }
    } catch (err) {
      // Cada error bajo su campo y, arriba, un aviso general. Si alguno es de
      // algo que el formulario no muestra, el aviso lleva el detalle completo
      // (`mensajeDeError`): «Roles inexistentes» dice qué corregir, «No se
      // pudo guardar» no.
      const porCampo = erroresPorCampo(err);
      const claves = Object.keys(porCampo);
      setErroresCampo(porCampo);
      setError(
        claves.length > 0 &&
          claves.every((clave) => CAMPOS_DEL_FORMULARIO.has(clave)) &&
          !hayErroresGenerales(err)
          ? "Revise los campos marcados."
          : mensajeDeError(err, "No se pudo guardar el usuario."),
      );
      enfocarPrimerError(formRef.current);
    } finally {
      setIsLoading(false);
    }
  }

  function toggleResetOption(key) {
    setResetOptions({ ...resetOptions, [key]: !resetOptions[key] });
  }

  async function handleConfirmReset() {
    setIsResetting(true);
    setResetError(null);
    try {
      await adminUsersService.resetPassword(id, resetOptions);
      setResetMessage(textoDelRestablecimiento(resetOptions));
      setResetOptions(EMPTY_RESET_OPTIONS);
    } catch (err) {
      setResetError(
        mensajeDeError(
          err,
          "No se pudo ejecutar la acción de restablecimiento.",
        ),
      );
    } finally {
      setIsResetting(false);
      setIsConfirmResetOpen(false);
    }
  }

  return (
    <div className="user-form-page">
      {/* Pasa por la pregunta de cambios sin guardar, como el menú. */}
      <Link
        to="/admin/users"
        className="mz-small d-inline-flex align-items-center gap-1 mb-2"
        onClick={(event) => {
          event.preventDefault();
          guardedNavigate("/admin/users");
        }}
      >
        <Icon name="arrow-left" /> Volver a usuarios
      </Link>
      <div className="mz-view-head">
        <div>
          <h2>{isEditing ? "Editar usuario" : "Nuevo usuario"}</h2>
          <p className="mz-desc">
            {isEditing
              ? multiempresa
                ? "Los datos de la cuenta, las empresas donde trabaja y su contraseña."
                : "Los datos de la cuenta, sus roles y su contraseña."
              : multiempresa
                ? "La cuenta nace con su nombre, su correo y, si corresponde, la empresa y el rol con los que entra."
                : "La cuenta nace con su nombre, su correo y el rol con el que entra."}
          </p>
        </div>
      </div>

      <div className="mz-stack">
        <section className="mz-card">
          <div className="mz-card-head">
            <h3>Datos de la cuenta</h3>
          </div>
          <form ref={formRef} onSubmit={handleSubmit} className="mz-card-body">
            {error && (
              <div className="mz-alert mz-alert--bad" role="alert">
                <Icon name="x-octagon" />
                {error}
              </div>
            )}
            {mensajeDatos && (
              <div className="mz-alert mz-alert--ok" role="status">
                <Icon name="check2-circle" />
                {mensajeDatos}
              </div>
            )}

            {/* Obligatorios marcados y cada error del servidor bajo su campo
                (auditoría UX/UI, fase 2, 28/10/2026). */}
            <div className="mz-field-grid">
              <Campo
                id="first_name"
                etiqueta="Nombres"
                obligatorio
                error={erroresCampo.first_name}
                className="mz-field"
              >
                <input
                  name="first_name"
                  className="form-control"
                  value={form.first_name}
                  onChange={handleChange}
                />
              </Campo>

              <Campo
                id="last_name"
                etiqueta="Apellidos"
                obligatorio
                error={erroresCampo.last_name}
                className="mz-field"
              >
                <input
                  name="last_name"
                  className="form-control"
                  value={form.last_name}
                  onChange={handleChange}
                />
              </Campo>

              <Campo
                id="codigo_empleado"
                etiqueta="Código de empleado"
                ayuda="El de nómina (p. ej. 20104758). Con él la persona consulta su rol de pagos: solo lo asigna la administración. Déjelo vacío si la cuenta no es de un empleado."
                error={erroresCampo.codigo_empleado}
                className="mz-field"
              >
                <input
                  name="codigo_empleado"
                  className="form-control"
                  maxLength={40}
                  inputMode="numeric"
                  value={form.codigo_empleado}
                  onChange={handleChange}
                  // Lo cambia solo nómina (`roles_pago.habilitar`, 22/10/2026).
                  disabled={!puedeEditarCodigo}
                />
              </Campo>

              <Campo
                id="username"
                etiqueta="Nombre de usuario"
                ayuda={
                  isEditing
                    ? "Se compuso al crear la cuenta y no cambia: es con lo que entra y con lo que aparece en la auditoría."
                    : "Se compone solo: inicial del nombre y apellido completo, sin tildes ni eñes. Si ya está en uso, se le añade un número."
                }
                error={erroresCampo.username}
                className="mz-field"
              >
                <input
                  name="username"
                  className="form-control"
                  value={isEditing ? form.username : usernamePropuesto}
                  readOnly
                />
              </Campo>

              <Campo
                id="email"
                etiqueta="Correo"
                obligatorio
                error={erroresCampo.email}
                className="mz-field"
              >
                <input
                  name="email"
                  type="email"
                  className="form-control"
                  value={form.email}
                  onChange={handleChange}
                />
              </Campo>

              {!isEditing && (
                <div>
                  <Campo
                    id="password"
                    etiqueta="Contraseña inicial (opcional)"
                    ayuda="Si la deja vacía, la cuenta nace con la clave temporal. Con una u otra, la persona debe cambiarla al entrar por primera vez."
                    error={erroresCampo.password}
                    className="mz-field"
                  >
                    <input
                      name="password"
                      type="password"
                      className="form-control"
                      autoComplete="new-password"
                      value={form.password}
                      onChange={handleChange}
                    />
                  </Campo>
                  {form.password && <ReglasContrasena clave={form.password} />}
                </div>
              )}
            </div>

            {!isEditing && puedeAsignarEmpresas && (
              <div className="mz-section mt-3">
                <h4>{multiempresa ? "Empresa y rol" : "Rol"}</h4>
                <SeleccionEmpresaYRol
                  empresaId={alta.empresaId}
                  rolId={alta.rolId}
                  onChange={setAlta}
                />
              </div>
            )}

            {/* Cada tarjeta guarda lo suyo: el botón dice qué (auditoría
                UX/UI, fase 2). */}
            <div className="mz-actions justify-content-between align-items-center mt-3">
              <LeyendaObligatorios />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isLoading}
              >
                {isLoading
                  ? "Guardando…"
                  : isEditing
                    ? "Guardar datos"
                    : "Crear usuario"}
              </button>
            </div>
          </form>
        </section>

        {isEditing && (
          <AsignacionEmpresas
            usuarioId={id}
            onCambiosSinGuardar={setAccesosSinGuardar}
          />
        )}

        {isEditing && canResetPassword && (
          <section className="mz-card">
            <div className="mz-card-head">
              <h3>Restablecer contraseña</h3>
            </div>
            <div className="mz-card-body">
              {resetMessage && (
                <div className="mz-alert mz-alert--ok" role="status">
                  <Icon name="check2-circle" />
                  {resetMessage}
                </div>
              )}
              {resetError && (
                <div className="mz-alert mz-alert--bad" role="alert">
                  <Icon name="x-octagon" />
                  {resetError}
                </div>
              )}
              <div className="form-check">
                <input
                  id="send_link"
                  type="checkbox"
                  className="form-check-input"
                  checked={resetOptions.send_link}
                  onChange={() => toggleResetOption("send_link")}
                />
                <label className="form-check-label" htmlFor="send_link">
                  Enviar enlace de restablecimiento por correo
                </label>
              </div>
              <div className="form-check">
                <input
                  id="force_change_on_next_login"
                  type="checkbox"
                  className="form-check-input"
                  checked={resetOptions.force_change_on_next_login}
                  onChange={() =>
                    toggleResetOption("force_change_on_next_login")
                  }
                />
                <label
                  className="form-check-label"
                  htmlFor="force_change_on_next_login"
                >
                  Forzar cambio de contraseña en el próximo inicio de sesión
                </label>
              </div>
              <div className="form-check">
                <input
                  id="revoke_sessions"
                  type="checkbox"
                  className="form-check-input"
                  checked={resetOptions.revoke_sessions}
                  onChange={() => toggleResetOption("revoke_sessions")}
                />
                <label className="form-check-label" htmlFor="revoke_sessions">
                  Cerrar sesiones activas
                </label>
              </div>
              <div className="mz-actions justify-content-end mt-3">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!Object.values(resetOptions).some(Boolean)}
                  onClick={() => setIsConfirmResetOpen(true)}
                >
                  <Icon name="key" /> Aplicar restablecimiento
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

      <ConfirmDialog
        isOpen={isConfirmResetOpen}
        title="Restablecer contraseña"
        message="Esta acción no puede deshacerse. ¿Confirma que desea ejecutar las opciones seleccionadas?"
        isLoading={isResetting}
        onConfirm={handleConfirmReset}
        onCancel={() => setIsConfirmResetOpen(false)}
      />
    </div>
  );
}
