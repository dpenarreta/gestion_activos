import { useState } from "react";
import { Link } from "react-router-dom";

import { adminUsersService } from "../../../api/adminUsersService";
import { Presencia } from "../../../components/admin/Chat/Presencia";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useAdminUsers } from "../../../hooks/useAdminUsers";
import { useVistaDeTarjetas } from "../../../hooks/useMediaQuery";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import { formatearFecha } from "../../../utils/formato";
import "./UsersList.css";
import { useMultiempresa } from "../../../components/admin/AdminSidebar/SelectorEmpresa";
import { confirmar } from "../../../components/common/Confirmar/confirmar";

const STATUS_LABELS = {
  active: "Activo",
  disabled: "Deshabilitado",
  blocked: "Bloqueado",
};

// El estado con el color de la identidad: activa en verde y bloqueada en
// rojo; deshabilitada va en neutro porque es una pausa decidida, no una
// alarma.
const STATUS_PILLS = {
  active: "mz-pill--ok",
  disabled: "mz-pill--neutral",
  blocked: "mz-pill--bad",
};

export function UsersList() {
  const multiempresa = useMultiempresa();
  const enTarjetas = useVistaDeTarjetas();
  // Crear y deshabilitar tienen su propio permiso: con solo ver, el botón
  // terminaría en un 403.
  const puedeCrear = usePermission("usuarios.crear");
  const puedeDeshabilitar = usePermission("usuarios.deshabilitar");
  const {
    users,
    count,
    hasNext,
    hasPrevious,
    page,
    setPage,
    filters,
    updateFilters,
    isLoading,
    error,
    refresh,
  } = useAdminUsers();
  const [searchInput, setSearchInput] = useState("");
  const [actionError, setActionError] = useState(null);
  const [actionAviso, setActionAviso] = useState(null);
  const [procesando, setProcesando] = useState(null);

  const hayFiltros = Object.values(filters).some(Boolean);

  function handleSearchSubmit(event) {
    event.preventDefault();
    updateFilters({ q: searchInput });
  }

  function limpiarFiltros() {
    setSearchInput("");
    updateFilters({ q: "", status: "" });
  }

  async function runAction(user, action) {
    setActionError(null);
    setActionAviso(null);
    // Deshabilitar cierra el acceso de una persona: se confirma con su nombre.
    if (
      action === "disable" &&
      !(await confirmar({
        titulo: `¿Deshabilitar a ${user.full_name || user.username}?`,
        mensaje:
          "No podrá entrar al sistema hasta que se vuelva a habilitar la cuenta.",
        accion: "Deshabilitar",
      }))
    ) {
      return;
    }
    setProcesando(user.id);
    try {
      await adminUsersService[action](user.id);
      setActionAviso(
        `La cuenta de ${user.full_name || user.username} quedó ${action === "disable" ? "deshabilitada" : "habilitada"}.`,
      );
      refresh();
    } catch (err) {
      setActionError(mensajeDeError(err, "No se pudo ejecutar la acción."));
    } finally {
      setProcesando(null);
    }
  }

  return (
    <div className="users-list-page">
      <div className="mz-view-head">
        <div>
          <h2>Usuarios</h2>
          <p className="mz-desc">
            Las cuentas que entran al sistema, en qué empresas trabajan y con
            qué rol.
          </p>
        </div>
        {puedeCrear && (
          <div className="mz-view-actions">
            <Link to="/admin/users/new" className="btn btn-primary btn-sm">
              <Icon name="person-plus" /> Nuevo usuario
            </Link>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSearchSubmit}
        className="mz-filter-bar"
        role="search"
      >
        <label className="mz-fb-search">
          <Icon name="search" />
          <span className="visually-hidden">Buscar usuarios</span>
          <input
            type="search"
            placeholder="Buscar por nombre, correo o usuario"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>
        <select
          className="form-select form-select-sm"
          aria-label="Filtrar por estado"
          value={filters.status}
          onChange={(event) => updateFilters({ status: event.target.value })}
        >
          <option value="">Todos los estados</option>
          <option value="active">Activo</option>
          <option value="disabled">Deshabilitado</option>
          <option value="blocked">Bloqueado</option>
        </select>
        <button type="submit" className="btn btn-outline-secondary btn-sm">
          Buscar
        </button>
      </form>

      {actionAviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          {actionAviso}
        </div>
      )}
      {actionError && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {actionError}
        </div>
      )}

      {/* En el teléfono, cada cuenta en una tarjeta con sus acciones a 44 px:
          ocho columnas a 375 px solo se leían desplazándose de lado
          (auditoría UX/UI, fase 3, 28/10/2026). */}
      <div className="mz-table-wrap mz-table-wrap--con-tarjetas">
        <table className="mz-table mz-table--ancha">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Correo</th>
              <th>Estado</th>
              <th>{multiempresa ? "Empresas" : "Roles"}</th>
              {/* «Globales» porque los de cada empresa ya van en la columna
                  anterior: sin el adjetivo, un guion aquí se lee como que la
                  cuenta no tiene ningún rol en ninguna parte. */}
              <th>Roles globales</th>
              <th>Creado</th>
              {/* Junto a «Creado» porque la pregunta es la misma mirada
                  desde los dos extremos: desde cuándo existe la cuenta y
                  desde cuándo no la usa nadie. */}
              <th>Última conexión</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {/* Cargando, error con reintento y un vacío que distingue «no hay
                cuentas» de «el filtro no encuentra nada» (auditoría UX/UI,
                fase 2, 28/10/2026). */}
            <FilaDeEstado
              columnas={8}
              cargando={isLoading && users.length === 0}
              error={error}
              onReintentar={refresh}
              vacio={!isLoading && users.length === 0}
              textoVacio="Todavía no hay usuarios registrados."
              hayFiltros={hayFiltros}
              onLimpiarFiltros={limpiarFiltros}
            />
            {!error &&
              users.map((user) => (
                <tr key={user.id}>
                  {/* El superusuario lleva una sola marca, la de «Roles
                    globales»: aquí repetía «Administrador» (auditoría UX/UI,
                    fase 2). */}
                  <td className="mz-strong">{user.username}</td>
                  <td>{user.email}</td>
                  <td>
                    <span
                      className={`mz-pill ${STATUS_PILLS[user.status] || "mz-pill--neutral"}`}
                    >
                      {STATUS_LABELS[user.status] || user.status}
                    </span>
                  </td>
                  <td>
                    {/* A qué organización pertenece y qué hace en cada una: es
                      la primera pregunta al revisar por qué alguien no ve una
                      pantalla, y abrir ficha por ficha la vuelve impracticable. */}
                    {(user.empresas ?? []).length === 0 && (
                      <span className="mz-faint">—</span>
                    )}
                    {(user.empresas ?? []).map((empresa) => (
                      <div key={empresa.id} className="users-list-empresa">
                        {multiempresa && (
                          <span className="fw-semibold">{empresa.nombre}</span>
                        )}
                        {multiempresa && empresa.es_predeterminada && (
                          <span className="mz-pill mz-pill--neutral ms-1">
                            Predeterminada
                          </span>
                        )}
                        <div className="mz-faint mz-small">
                          {empresa.roles.map((rol) => rol.name).join(", ") ||
                            (user.is_superuser
                              ? "Todos los permisos"
                              : "Sin rol")}
                        </div>
                      </div>
                    ))}
                  </td>
                  <td>
                    {/* Superusuario es una marca de la cuenta, no un rol: tiene
                      todos los permisos sin necesitar ninguno. */}
                    {user.is_superuser && (
                      <span
                        className="mz-pill mz-pill--ok me-1"
                        title="Marca de la cuenta: todos los permisos en todas las empresas, sin necesitar roles"
                      >
                        <Icon name="shield-lock" /> Superusuario (cuenta)
                      </span>
                    )}
                    {user.roles.map((role) => role.name).join(", ") ||
                      (user.is_superuser ? "" : "—")}
                  </td>
                  <td>{formatearFecha(user.created_at)}</td>
                  <td>
                    {/* «Nunca» y no un guion: el guion se lee como un dato
                      que falta por cargar, y aquí no falta nada —esa
                      cuenta existe y no ha entrado jamás, que es
                      exactamente lo que hay que ver—. */}
                    {/* En línea ahora; si no, su última conexión (o el último
                      inicio de sesión de antes de medirla). */}
                    {user.en_linea ? (
                      <Presencia estado={user} conTexto />
                    ) : user.ultima_conexion || user.last_login ? (
                      formatearFecha(
                        user.ultima_conexion || user.last_login,
                        true,
                      )
                    ) : (
                      <span className="mz-faint">Nunca</span>
                    )}
                  </td>
                  <td className="acciones">
                    <Link
                      to={`/admin/users/${user.id}`}
                      className="btn btn-outline-primary btn-sm"
                      aria-label={`Editar ${user.username}`}
                    >
                      Editar
                    </Link>
                    {!puedeDeshabilitar ? null : user.status === "active" ? (
                      <button
                        type="button"
                        className="btn btn-outline-warning btn-sm"
                        disabled={procesando === user.id}
                        onClick={() => runAction(user, "disable")}
                      >
                        Deshabilitar
                        <span className="visually-hidden">
                          {" "}
                          a {user.username}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-outline-success btn-sm"
                        disabled={procesando === user.id}
                        onClick={() => runAction(user, "enable")}
                      >
                        Habilitar
                        <span className="visually-hidden">
                          {" "}
                          a {user.username}
                        </span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {enTarjetas && (
        <div className="mz-cards">
          <EstadoDeCarga
            cargando={isLoading && users.length === 0}
            error={error}
            onReintentar={refresh}
            vacio={!isLoading && users.length === 0}
            textoVacio="Todavía no hay usuarios registrados."
            hayFiltros={hayFiltros}
            onLimpiarFiltros={limpiarFiltros}
          />
          {!error && users.length > 0 && (
            <ul className="mz-cards-lista" aria-label="Usuarios">
              {users.map((user) => (
                <li key={user.id} className="mz-card-row">
                  <div className="mz-row-between">
                    <strong className="mz-card-row__titulo">
                      {user.username}
                    </strong>
                    <span
                      className={`mz-pill ${STATUS_PILLS[user.status] || "mz-pill--neutral"}`}
                    >
                      {STATUS_LABELS[user.status] || user.status}
                    </span>
                  </div>
                  <div className="mz-card-row__titulo mz-small">
                    {user.email}
                  </div>
                  <div className="mz-card-meta">
                    {user.is_superuser && <span>Superusuario (cuenta)</span>}
                    {(user.empresas ?? []).map((empresa) => (
                      <span key={empresa.id}>
                        {multiempresa ? `${empresa.nombre}: ` : ""}
                        {empresa.roles.map((rol) => rol.name).join(", ") ||
                          (user.is_superuser
                            ? "Todos los permisos"
                            : "Sin rol")}
                      </span>
                    ))}
                    <span>
                      {user.en_linea
                        ? "En línea"
                        : user.ultima_conexion || user.last_login
                          ? `Última conexión: ${formatearFecha(
                              user.ultima_conexion || user.last_login,
                              true,
                            )}`
                          : "Nunca se ha conectado"}
                    </span>
                  </div>
                  <div className="mz-card-acciones">
                    <Link
                      to={`/admin/users/${user.id}`}
                      className="btn btn-outline-primary btn-sm"
                      aria-label={`Editar ${user.username}`}
                    >
                      Editar
                    </Link>
                    {!puedeDeshabilitar ? null : user.status === "active" ? (
                      <button
                        type="button"
                        className="btn btn-outline-warning btn-sm"
                        disabled={procesando === user.id}
                        onClick={() => runAction(user, "disable")}
                      >
                        Deshabilitar
                        <span className="visually-hidden">
                          {" "}
                          a {user.username}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-outline-success btn-sm"
                        disabled={procesando === user.id}
                        onClick={() => runAction(user, "enable")}
                      >
                        Habilitar
                        <span className="visually-hidden">
                          {" "}
                          a {user.username}
                        </span>
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Paginacion
        total={count}
        pagina={page}
        hasNext={hasNext}
        hasPrevious={hasPrevious}
        onCambiarPagina={setPage}
        etiqueta="usuarios"
      />
    </div>
  );
}
