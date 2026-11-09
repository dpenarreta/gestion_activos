import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { adminUsersService } from "../../../api/adminUsersService";
import { getEmpresaActiva } from "../../../api/client";
import { empresasService } from "../../../api/empresasService";
import { institucionalService } from "../../../api/institucionalService";
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
import { CargoDelUsuario } from "./CargoDelUsuario";
import { motivoDelAlta } from "./cargosDelAlta";
import { SelectorDeCargo } from "./SelectorDeCargo";

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
const ASIGNACION_DE_CARGOS =
  "/admin/institucional/estructura?pestana=asignaciones";
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
  // Poner a alguien en un cargo es el mismo poder que en Institucional ›
  // Estructura › Asignación de cargos; el servidor lo vuelve a comprobar.
  const puedeAsignarCargos = usePermission("institucional.asignar");
  const location = useLocation();
  const multiempresa = useMultiempresa();
  const { setIsDirty, guardedNavigate } = useUnsavedChanges();
  // Con qué empresa y rol nace la cuenta. Solo se pregunta al crearla: en
  // la ficha ya está el bloque completo, con todas sus empresas.
  const [alta, setAlta] = useState(EMPTY_ALTA);
  // El cargo del organigrama que ocupará (09/11/2026): de él sale el rol de
  // cargo, que no se elige a mano. Es de la empresa elegida, así que cambiar
  // de empresa lo borra.
  const [cargo, setCargo] = useState(null);
  // Lo que dejó el alta al llegar a la ficha: si el cargo quedó asignado o si
  // falló y hay que asignarlo a mano. Llega en el estado de la navegación y
  // se copia aquí (ver el efecto de abajo).
  const [avisoAlta, setAvisoAlta] = useState(null);
  // Las empresas en que trabaja quien crea la cuenta: `null` mientras carga,
  // `undefined` si no se pudo saber. El organigrama de una empresa ajena le
  // llega vacío, y la pantalla decía en falso «no tiene cargos» (revisión
  // UX/UI, 09/11/2026). Los permisos por empresa no llegan al navegador: se
  // aplica la regla de la membresía y el servidor comprueba el permiso.
  const [misEmpresas, setMisEmpresas] = useState(null);
  // La empresa que propone el selector al montar: elegida por el sistema, no
  // por quien crea la cuenta, así que no es un cambio que avisar al salir.
  const [empresaPropuesta, setEmpresaPropuesta] = useState(null);
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
  // Hay campo de cargo solo al crear, con los dos poderes que hacen falta
  // (darle la empresa y ponerlo en el cargo) y con la empresa ya conocida:
  // los cargos son de ella.
  const puedeCargosAqui =
    !isEditing &&
    puedeAsignarEmpresas &&
    puedeAsignarCargos &&
    alta.empresaId !== null;
  const empresaDelAlta = Array.isArray(misEmpresas)
    ? misEmpresas.find((empresa) => empresa.id === alta.empresaId)
    : null;
  // Sin saber sus empresas (falló la consulta) se ofrece igual: el servidor
  // rechaza la asignación si no corresponde, y la ficha lo avisa.
  const trabajaEnLaEmpresa =
    misEmpresas === undefined || Boolean(empresaDelAlta);
  const conCargo = puedeCargosAqui && trabajaEnLaEmpresa;
  const cargoAjeno =
    puedeCargosAqui && Array.isArray(misEmpresas) && !empresaDelAlta;
  const cargoElegido = conCargo ? cargo : null;
  const nombreCompleto = `${form.first_name} ${form.last_name}`.trim();

  // En un efecto y no al montar: las rutas «nuevo» y «ficha» pintan el mismo
  // componente y React puede reutilizarlo al pasar de una a otra. Se quita
  // de la navegación para que recargar la ficha no lo vuelva a mostrar.
  useEffect(() => {
    const aviso = location.state?.avisoAlta;
    if (!aviso) return;
    setAvisoAlta(aviso);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  useEffect(() => {
    if (isEditing || !puedeAsignarEmpresas || !puedeAsignarCargos) {
      return undefined;
    }
    let vigente = true;
    Promise.resolve()
      .then(() => empresasService.mias())
      .then((datos) => vigente && setMisEmpresas(datos?.empresas ?? []))
      .catch(() => vigente && setMisEmpresas(undefined));
    return () => {
      vigente = false;
    };
  }, [isEditing, puedeAsignarEmpresas, puedeAsignarCargos]);

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
    (!isEditing &&
      (alta.rolId !== null ||
        cargo !== null ||
        (alta.empresaId !== null && alta.empresaId !== empresaPropuesta)));

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

  /**
   * Segundo paso del alta: la cuenta recién creada ocupa su cargo. Va en la
   * empresa elegida en el alta (no en la de la pestaña) y con un motivo
   * legible para la bitácora del organigrama. Nunca lanza: devuelve el aviso
   * que verá la ficha, de éxito o de que falta asignar el cargo.
   */
  async function asignarCargoDelAlta(usuarioId) {
    try {
      await institucionalService.asignar(
        usuarioId,
        cargoElegido.id,
        motivoDelAlta(nombreCompleto, cargoElegido),
        { empresa: alta.empresaId },
      );
      return {
        tipo: "ok",
        texto: cargoElegido.rol
          ? `Cuenta creada en el cargo ${cargoElegido.etiqueta}: ya tiene el rol ${cargoElegido.rol.nombre}.`
          : `Cuenta creada en el cargo ${cargoElegido.etiqueta}.`,
      };
    } catch (errCargo) {
      const motivo = mensajeDeError(errCargo, "el servidor no respondió");
      // La empresa del alta, que puede no ser la de la pestaña: el aviso la
      // nombra y el enlace abre Asignación de cargos en ella, ya filtrada
      // por la persona (revisión UX/UI, 09/11/2026).
      const empresa = empresaDelAlta?.nombre;
      const otraEmpresa = String(alta.empresaId) !== String(getEmpresaActiva());
      const buscar = `&buscar=${encodeURIComponent(nombreCompleto)}`;
      return {
        tipo: "falta-cargo",
        texto: `La cuenta se creó, pero no se pudo asignar el cargo ${cargoElegido.etiqueta}${
          empresa ? ` en la empresa ${empresa}` : ""
        } (${motivo.replace(/\.$/, "")}). Sin el cargo no tiene el rol del cargo: asígneselo en Institucional › Estructura › Asignación de cargos${
          empresa && otraEmpresa ? ` de ${empresa}` : ""
        }.`,
        // `?empresa=` lo toma la aplicación al cargar (`tomarEmpresaDeLaDireccion`):
        // por eso, si es otra empresa, el enlace recarga en vez de navegar.
        destino: otraEmpresa
          ? `${ASIGNACION_DE_CARGOS}${buscar}&empresa=${alta.empresaId}`
          : `${ASIGNACION_DE_CARGOS}${buscar}`,
        recargar: otraEmpresa,
      };
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setErroresCampo({});
    setMensajeDatos(null);
    // Los obligatorios se validan aquí y todos a la vez, con cada error bajo
    // su campo y el foco en el primero: corregir de uno en uno, enviando cada
    // vez, era descubrir el siguiente fallo solo al arreglar el anterior. Y
    // sin `required`: la burbuja del navegador no se parecía al resto del
    // formulario (auditoría UX/UI, 06/11/2026). El formato del correo y lo
    // demás lo sigue diciendo el servidor.
    const faltan = {};
    if (!(form.first_name ?? "").trim())
      faltan.first_name = "Escriba los nombres.";
    if (!(form.last_name ?? "").trim())
      faltan.last_name = "Escriba los apellidos.";
    if (!(form.email ?? "").trim()) faltan.email = "Escriba el correo.";
    // Sin rol la cuenta nacería sin ver nada. Con `empresaId` vacío el
    // selector no cargó o no hay empresas activas: entonces no se exige. Con
    // un cargo tampoco: la cuenta recibe el rol del cargo.
    if (
      !isEditing &&
      puedeAsignarEmpresas &&
      alta.empresaId !== null &&
      !alta.rolId &&
      !cargoElegido
    )
      faltan.rol = conCargo
        ? "Elija un rol o, si ocupa un cargo, el cargo del organigrama."
        : "Elija el rol con el que entra esta persona.";
    if (Object.keys(faltan).length > 0) {
      setErroresCampo(faltan);
      setError("Revise los campos marcados.");
      enfocarPrimerError(formRef.current);
      return;
    }
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
          // Con cargo y sin rol adicional, la membresía nace sin roles: el
          // del cargo se lo pone la asignación de abajo.
          ...(puedeAsignarEmpresas &&
          alta.empresaId &&
          (alta.rolId || cargoElegido)
            ? {
                empresas: [
                  {
                    empresa_id: alta.empresaId,
                    roles: alta.rolId ? [alta.rolId] : [],
                    es_predeterminada: true,
                  },
                ],
              }
            : {}),
        });
        // La cuenta ya existe: pase lo que pase con el cargo, se va a su
        // ficha. Si el cargo falla se dice allí, con el camino para
        // asignarlo: dejarla a medias en silencio es lo que se quiere evitar.
        const avisoDelCargo = cargoElegido
          ? await asignarCargoDelAlta(created.id)
          : null;
        // Ya guardado: no queda nada que perder al pasar a su ficha.
        setOriginal(form);
        setAlta(EMPTY_ALTA);
        setCargo(null);
        navigate(`/admin/users/${created.id}`, {
          replace: true,
          state: avisoDelCargo ? { avisoAlta: avisoDelCargo } : undefined,
        });
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
        {/* Montada desde el principio y vacía: el éxito del alta llega
            después (al copiarse del estado de la navegación) y una región
            viva que aparece ya llena no siempre se anuncia (revisión UX/UI,
            09/11/2026). Fuera de la vista mientras no dice nada. */}
        <div
          role="status"
          className={
            isEditing && avisoAlta?.tipo === "ok"
              ? undefined
              : "visually-hidden"
          }
        >
          {isEditing && avisoAlta?.tipo === "ok" && (
            <div className="mz-alert mz-alert--ok">
              <Icon name="check2-circle" />
              <span>{avisoAlta.texto}</span>
            </div>
          )}
        </div>
        {isEditing && avisoAlta?.tipo === "falta-cargo" && (
          <div className="mz-alert mz-alert--warn" role="alert">
            <Icon name="exclamation-triangle" />
            <span className="flex-grow-1">
              {avisoAlta.texto}{" "}
              {avisoAlta.recargar ? (
                // Otra empresa: se recarga para que la tome la pestaña.
                <a href={avisoAlta.destino}>Ir a Asignación de cargos</a>
              ) : (
                <Link
                  to={avisoAlta.destino}
                  onClick={(event) => {
                    event.preventDefault();
                    guardedNavigate(avisoAlta.destino);
                  }}
                >
                  Ir a Asignación de cargos
                </Link>
              )}
            </span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setAvisoAlta(null)}
            >
              Entendido
            </button>
          </div>
        )}
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
                {/* Con una sola empresa el título repetía la etiqueta «Rol»
                    justo debajo (auditoría UX/UI, 06/11/2026). */}
                {/* Con una sola empresa, título solo si hay cargo: «Rol» a
                    secas repetía la etiqueta de abajo. */}
                {(multiempresa || conCargo) && (
                  <h4>
                    {multiempresa
                      ? conCargo
                        ? "Empresa, cargo y rol"
                        : "Empresa y rol"
                      : "Cargo y rol"}
                  </h4>
                )}
                <SeleccionEmpresaYRol
                  empresaId={alta.empresaId}
                  rolId={alta.rolId}
                  rolOpcional={Boolean(cargoElegido)}
                  ofreceCargo={conCargo}
                  campoCargo={
                    cargoAjeno ? (
                      <p className="mz-small mz-faint mb-0">
                        <Icon name="info-circle" /> No tiene acceso al
                        organigrama de esta empresa porque no trabaja en ella:
                        asigne el cargo después, desde esa empresa.
                      </p>
                    ) : (
                      conCargo && (
                        <SelectorDeCargo
                          empresaId={alta.empresaId}
                          cargo={cargo}
                          nombreCompleto={nombreCompleto}
                          onCambio={(elegido) => {
                            setCargo(elegido);
                            // Con cargo, el rol ya no falta.
                            if (elegido && erroresCampo.rol) {
                              setErroresCampo({
                                ...erroresCampo,
                                rol: undefined,
                              });
                            }
                          }}
                        />
                      )
                    )
                  }
                  errores={{
                    empresa: erroresCampo.empresa,
                    rol: erroresCampo.rol,
                  }}
                  onChange={(siguiente, { propuesta = false } = {}) => {
                    // Los cargos son de cada empresa: el elegido no sirve en
                    // otra.
                    if (siguiente.empresaId !== alta.empresaId) setCargo(null);
                    setAlta(siguiente);
                    if (propuesta) setEmpresaPropuesta(siguiente.empresaId);
                    if (erroresCampo.rol && siguiente.rolId) {
                      setErroresCampo({ ...erroresCampo, rol: undefined });
                    }
                  }}
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
          >
            <CargoDelUsuario
              usuarioId={id}
              nombre={`${original.first_name} ${original.last_name}`}
            />
          </AsignacionEmpresas>
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
