import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { rolesService } from "../../../api/rolesService";
import { AnuncioDeResultados } from "../../../components/common/AnuncioDeResultados/AnuncioDeResultados";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { FilaDeEstado } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";
import { coincideBusqueda } from "../../../utils/busqueda";
import { mensajeDeError } from "../../../utils/errores";
import "./RolesPanel.css";

/**
 * Listado de roles.
 *
 * Es un panel y no una página completa: vive dentro de `RolesPage`, que aporta
 * el encabezado y las pestañas compartidas con el catálogo de permisos. Por
 * eso «Nuevo rol» va en la barra del panel y no en el encabezado de la vista:
 * en la pestaña del catálogo no hay nada que crear.
 *
 * Con buscador (06/11/2026): con los roles de cada cargo del organigrama son
 * más de cien y encontrar el que se quiere editar era recorrer la tabla. La
 * lista ya está cargada, así que filtra en cada tecla, sin tildes ni
 * mayúsculas (`coincideBusqueda`). Lo buscado y el tipo van en la dirección:
 * al volver de editar un rol, la lista sigue filtrada.
 */
export function RolesPanel() {
  const puedeEditar = usePermission("roles.editar");
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [eliminando, setEliminando] = useState(false);
  const [aEliminar, setAEliminar] = useState(null);
  const [params, setParams] = useSearchParams();
  const texto = params.get("q") ?? "";
  const tipo = params.get("tipo") ?? "";

  // `replace`: cada letra no debe quedar como un paso del «atrás».
  function cambiarFiltro(clave, valor) {
    const siguientes = new URLSearchParams(params);
    if (valor) siguientes.set(clave, valor);
    else siguientes.delete(clave);
    setParams(siguientes, { replace: true });
  }

  const visibles = roles.filter(
    (role) =>
      (tipo === "" || (tipo === "cargo" ? Boolean(role.cargo) : !role.cargo)) &&
      coincideBusqueda(texto, role.name, role.cargo?.empresa),
  );
  const filtrando = texto.trim() !== "" || tipo !== "";
  const campo = useRef(null);

  // Al limpiar, el foco vuelve al buscador: el botón desaparece con el vacío
  // y, si no, quedaría perdido en la página.
  function limpiarFiltros() {
    setParams(new URLSearchParams(), { replace: true });
    campo.current?.focus();
  }

  function loadRoles() {
    setIsLoading(true);
    setErrorCarga(null);
    rolesService
      .list()
      .then(setRoles)
      .catch((err) =>
        setErrorCarga(
          mensajeDeError(err, "No se pudo cargar el listado de roles."),
        ),
      )
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    loadRoles();
  }, []);

  async function confirmarEliminacion() {
    setEliminando(true);
    try {
      await rolesService.remove(aEliminar.id);
      setAEliminar(null);
      setError(null);
      loadRoles();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo eliminar el rol."));
      setAEliminar(null);
    } finally {
      setEliminando(false);
    }
  }

  return (
    <div className="roles-list-page">
      <div className="roles-list-barra">
        <p className="mz-faint mb-0">
          Un rol agrupa permisos. Se asigna a un usuario desde su ficha, en{" "}
          <Link to="/admin/users">Usuarios</Link>.
        </p>
        {puedeEditar && (
          <Link to="/admin/roles/new" className="btn btn-primary btn-sm">
            <Icon name="plus-lg" /> Nuevo rol
          </Link>
        )}
      </div>

      <div className="mz-filter-bar" role="search">
        <label className="mz-fb-search">
          <Icon name="search" />
          <span className="visually-hidden">Buscar roles</span>
          <input
            ref={campo}
            type="search"
            placeholder="Buscar un rol por su nombre"
            value={texto}
            onChange={(event) => cambiarFiltro("q", event.target.value)}
          />
        </label>
        <select
          className="form-select form-select-sm"
          aria-label="Tipo de rol"
          value={tipo}
          onChange={(event) => cambiarFiltro("tipo", event.target.value)}
        >
          <option value="">Todos los roles</option>
          <option value="manual">Se asignan a mano</option>
          <option value="cargo">De un cargo del organigrama</option>
        </select>
      </div>
      <AnuncioDeResultados
        termino={texto}
        total={visibles.length}
        cargando={isLoading}
      />

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th className="num">Permisos</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {/* Cargando, error con reintento y vacío dentro de la tabla
                (auditoría UX/UI, fase 2, 28/10/2026). */}
            <FilaDeEstado
              columnas={3}
              cargando={isLoading && roles.length === 0}
              error={errorCarga}
              onReintentar={loadRoles}
              vacio={!isLoading && visibles.length === 0}
              textoVacio="Todavía no hay roles registrados."
              hayFiltros={filtrando && roles.length > 0}
              termino={texto}
              onLimpiarFiltros={limpiarFiltros}
              etiquetaLimpiar="Limpiar búsqueda"
            />
            {!errorCarga &&
              visibles.map((role) => (
                <tr key={role.id}>
                  <td className="mz-strong">
                    {role.name}
                    {role.cargo && (
                      <span className="d-block mz-small mz-faint fw-normal">
                        <Icon name="diagram-3" /> Cargo del organigrama de{" "}
                        {role.cargo.empresa}: lo tiene quien ocupa el cargo
                      </span>
                    )}
                  </td>
                  <td className="num">{role.permission_codenames.length}</td>
                  <td className="acciones">
                    <Link
                      to={`/admin/roles/${role.id}`}
                      className="btn btn-outline-primary btn-sm"
                      aria-label={`${puedeEditar ? "Editar" : "Ver"} ${role.name}`}
                    >
                      {puedeEditar ? "Editar" : "Ver"}
                    </Link>
                    {/* El de un cargo se borra al borrar el cargo. */}
                    {puedeEditar && !role.cargo && (
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={() => setAEliminar(role)}
                        aria-label={`Eliminar ${role.name}`}
                      >
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        isOpen={Boolean(aEliminar)}
        title="¿Eliminar el rol?"
        confirmLabel="Eliminar rol"
        confirmVariant="danger"
        cancelClassName="btn-outline-secondary"
        isLoading={eliminando}
        message={
          aEliminar
            ? `Se eliminará el rol "${aEliminar.name}". Los usuarios que lo tengan asignado perderán los ${aEliminar.permission_codenames.length} permisos que otorga.`
            : ""
        }
        onConfirm={confirmarEliminacion}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  );
}
