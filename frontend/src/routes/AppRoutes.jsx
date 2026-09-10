import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { AdminLayout } from "../components/admin/AdminLayout/AdminLayout";
import { RequirePermission } from "../components/common/RequirePermission/RequirePermission";
import { useAuth } from "../hooks/useAuth";
import { Forbidden } from "../pages/Errors/Forbidden";
import { NotFound } from "../pages/Errors/NotFound";
import { Home } from "../pages/Home/Home";
import { Login } from "../pages/Login/Login";
import { ChangePasswordRequired } from "../pages/PasswordReset/ChangePasswordRequired";
import { ForgotPassword } from "../pages/PasswordReset/ForgotPassword";
import { ResetPassword } from "../pages/PasswordReset/ResetPassword";
import { ActivoDetalle } from "../pages/Admin/Activos/ActivoDetalle";
import { DashboardPage } from "../pages/Admin/Dashboard/DashboardPage";
import { ActivoForm } from "../pages/Admin/Activos/ActivoForm";
import { ActivosList } from "../pages/Admin/Activos/ActivosList";
import { EscanerPage } from "../pages/Admin/Activos/EscanerPage";
import { ImportarActivosPage } from "../pages/Admin/Activos/ImportarActivosPage";
import { TiposDispositivoList } from "../pages/Admin/Activos/TiposDispositivoList";
import { ConfiguracionPage } from "../pages/Admin/Configuracion/ConfiguracionPage";
import { EmpresaForm } from "../pages/Admin/Empresas/EmpresaForm";
import { EmpresasList } from "../pages/Admin/Empresas/EmpresasList";
import { ComponentesList } from "../pages/Admin/Mantenimientos/ComponentesList";
import { MantenimientoForm } from "../pages/Admin/Mantenimientos/MantenimientoForm";
import { MantenimientosList } from "../pages/Admin/Mantenimientos/MantenimientosList";
import { AlertasPage } from "../pages/Admin/Alertas/AlertasPage";
import { PoliticasList } from "../pages/Admin/Politicas/PoliticasList";
import { SugerenciasPage } from "../pages/Admin/Politicas/SugerenciasPage";
import { CargaCatalogosPage } from "../pages/Admin/CargaCatalogos/CargaCatalogosPage";
import { DepartamentoForm } from "../pages/Admin/Organizacion/DepartamentoForm";
import { DepartamentosList } from "../pages/Admin/Organizacion/DepartamentosList";
import { ReportesPage } from "../pages/Admin/Reportes/ReportesPage";
import { ProveedorForm } from "../pages/Admin/Organizacion/ProveedorForm";
import { ProveedoresList } from "../pages/Admin/Organizacion/ProveedoresList";
import { SedeForm } from "../pages/Admin/Organizacion/SedeForm";
import { SedesList } from "../pages/Admin/Organizacion/SedesList";
import { EmpleadoForm } from "../pages/Admin/Organizacion/EmpleadoForm";
import { EmpleadosList } from "../pages/Admin/Organizacion/EmpleadosList";
import { Register } from "../pages/Register/Register";
import { RoleForm } from "../pages/Admin/Roles/RoleForm";
import { RolesPage } from "../pages/Admin/Roles/RolesPage";
import { UserForm } from "../pages/Admin/Users/UserForm";
import { UsersList } from "../pages/Admin/Users/UsersList";

const USUARIOS_VER = "usuarios.ver";
const ROLES_VER = "roles.ver";
const PERMISOS_VER = "permisos.ver";
const CONFIGURACION_VER = "configuracion.ver";
const EMPRESAS_VER = "empresas.ver";
const ORGANIZACION_VER = "organizacion.ver";
const ACTIVOS_VER = "activos.ver";
const MANTENIMIENTOS_VER = "mantenimientos.ver";
const ALERTAS_VER = "alertas.ver";
const POLITICAS_VER = "politicas.ver";
const CHANGE_PASSWORD_REQUIRED_PATH = "/change-password-required";

export function AppRoutes() {
  const { user } = useAuth();
  const location = useLocation();

  // Único punto de gateo (no un componente por-ruta como RequirePermission,
  // que es por-permiso, no por-estado-global): mientras haya un cambio de
  // contraseña obligatorio pendiente, cualquier otra ruta redirige aquí. El
  // backend ya lo exige de verdad (SessionAuthentication.authenticate) —
  // esto es solo para que la navegación no quede varada en un 403.
  if (
    user?.must_change_password &&
    location.pathname !== CHANGE_PASSWORD_REQUIRED_PATH
  ) {
    return <Navigate to={CHANGE_PASSWORD_REQUIRED_PATH} replace />;
  }

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path={CHANGE_PASSWORD_REQUIRED_PATH}
        element={<ChangePasswordRequired />}
      />
      <Route path="/403" element={<Forbidden />} />

      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route
          path="users"
          element={
            <RequirePermission permission={USUARIOS_VER}>
              <UsersList />
            </RequirePermission>
          }
        />
        <Route
          path="users/new"
          element={
            <RequirePermission permission={USUARIOS_VER}>
              <UserForm />
            </RequirePermission>
          }
        />
        <Route
          path="users/:id"
          element={
            <RequirePermission permission={USUARIOS_VER}>
              <UserForm />
            </RequirePermission>
          }
        />
        <Route
          path="empresas"
          element={
            <RequirePermission permission={EMPRESAS_VER}>
              <EmpresasList />
            </RequirePermission>
          }
        />
        {/* Antes que "empresas/:id", o esa ruta capturaría "new" como id. */}
        <Route
          path="empresas/new"
          element={
            <RequirePermission permission={EMPRESAS_VER}>
              <EmpresaForm />
            </RequirePermission>
          }
        />
        <Route
          path="empresas/:id"
          element={
            <RequirePermission permission={EMPRESAS_VER}>
              <EmpresaForm />
            </RequirePermission>
          }
        />
        <Route
          path="roles"
          element={
            <RequirePermission permission={ROLES_VER}>
              <RolesPage seccion="roles" />
            </RequirePermission>
          }
        />
        {/* Antes que "roles/:id", o esa ruta capturaría "permisos" como id. */}
        <Route
          path="roles/permisos"
          element={
            <RequirePermission permission={PERMISOS_VER}>
              <RolesPage seccion="permisos" />
            </RequirePermission>
          }
        />
        <Route
          path="roles/new"
          element={
            <RequirePermission permission={ROLES_VER}>
              <RoleForm />
            </RequirePermission>
          }
        />
        <Route
          path="roles/:id"
          element={
            <RequirePermission permission={ROLES_VER}>
              <RoleForm />
            </RequirePermission>
          }
        />
        {/* Las rutas fijas van antes que "activos/:id": si no, React Router
            resolvería "/admin/activos/escaner" como una ficha con id
            "escaner". */}
        <Route
          path="dashboard"
          element={
            <RequirePermission permission={ACTIVOS_VER}>
              <DashboardPage />
            </RequirePermission>
          }
        />
        <Route
          path="activos"
          element={
            <RequirePermission permission={ACTIVOS_VER}>
              <ActivosList />
            </RequirePermission>
          }
        />
        <Route
          path="activos/escaner"
          element={
            <RequirePermission permission={ACTIVOS_VER}>
              <EscanerPage />
            </RequirePermission>
          }
        />
        <Route
          path="activos/tipos"
          element={
            <RequirePermission permission={ACTIVOS_VER}>
              <TiposDispositivoList />
            </RequirePermission>
          }
        />
        <Route
          path="activos/importar"
          element={
            <RequirePermission permission={ACTIVOS_VER}>
              <ImportarActivosPage seccion="cargar" />
            </RequirePermission>
          }
        />
        <Route
          path="activos/importar/columnas"
          element={
            <RequirePermission permission={ACTIVOS_VER}>
              <ImportarActivosPage seccion="columnas" />
            </RequirePermission>
          }
        />
        <Route
          path="activos/new"
          element={
            <RequirePermission permission={ACTIVOS_VER}>
              <ActivoForm />
            </RequirePermission>
          }
        />
        <Route
          path="activos/:id"
          element={
            <RequirePermission permission={ACTIVOS_VER}>
              <ActivoDetalle />
            </RequirePermission>
          }
        />
        <Route
          path="activos/:id/editar"
          element={
            <RequirePermission permission={ACTIVOS_VER}>
              <ActivoForm />
            </RequirePermission>
          }
        />
        {/* Igual que en activos: las rutas fijas preceden a ":id". */}
        <Route
          path="mantenimientos"
          element={
            <RequirePermission permission={MANTENIMIENTOS_VER}>
              <MantenimientosList />
            </RequirePermission>
          }
        />
        <Route
          path="mantenimientos/componentes"
          element={
            <RequirePermission permission={MANTENIMIENTOS_VER}>
              <ComponentesList />
            </RequirePermission>
          }
        />
        <Route
          path="mantenimientos/new"
          element={
            <RequirePermission permission={MANTENIMIENTOS_VER}>
              <MantenimientoForm />
            </RequirePermission>
          }
        />
        <Route
          path="mantenimientos/:id"
          element={
            <RequirePermission permission={MANTENIMIENTOS_VER}>
              <MantenimientoForm />
            </RequirePermission>
          }
        />
        <Route
          path="politicas"
          element={
            <RequirePermission permission={POLITICAS_VER}>
              <PoliticasList />
            </RequirePermission>
          }
        />
        <Route
          path="alertas"
          element={
            <RequirePermission permission={ALERTAS_VER}>
              <AlertasPage />
            </RequirePermission>
          }
        />
        <Route
          path="renovacion/sugerencias"
          element={
            <RequirePermission permission={POLITICAS_VER}>
              <SugerenciasPage />
            </RequirePermission>
          }
        />
        {/* El permiso real lo comprueba cada catálogo por su lado —cargar
            tipos es editar el inventario, cargar empleados es editar la
            organización—; aquí basta con poder ver la sección. */}
        <Route
          path="catalogos/carga"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <CargaCatalogosPage />
            </RequirePermission>
          }
        />
        <Route
          path="organizacion/departamentos"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <DepartamentosList />
            </RequirePermission>
          }
        />
        <Route
          path="organizacion/departamentos/new"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <DepartamentoForm />
            </RequirePermission>
          }
        />
        <Route
          path="organizacion/departamentos/:id"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <DepartamentoForm />
            </RequirePermission>
          }
        />
        <Route
          path="reportes"
          element={
            <RequirePermission permission="reportes.ver">
              <ReportesPage />
            </RequirePermission>
          }
        />
        <Route
          path="organizacion/sedes"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <SedesList />
            </RequirePermission>
          }
        />
        <Route
          path="organizacion/sedes/new"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <SedeForm />
            </RequirePermission>
          }
        />
        <Route
          path="organizacion/sedes/:id"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <SedeForm />
            </RequirePermission>
          }
        />
        <Route
          path="organizacion/proveedores"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <ProveedoresList />
            </RequirePermission>
          }
        />
        <Route
          path="organizacion/proveedores/new"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <ProveedorForm />
            </RequirePermission>
          }
        />
        <Route
          path="organizacion/proveedores/:id"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <ProveedorForm />
            </RequirePermission>
          }
        />
        <Route
          path="organizacion/empleados"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <EmpleadosList />
            </RequirePermission>
          }
        />
        <Route
          path="organizacion/empleados/new"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <EmpleadoForm />
            </RequirePermission>
          }
        />
        <Route
          path="organizacion/empleados/:id"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <EmpleadoForm />
            </RequirePermission>
          }
        />
        {/* La sección de permisos dejó de ser independiente: ahora es una
            pestaña dentro de Roles. Se conserva la ruta anterior redirigiendo,
            para no romper enlaces guardados o marcados por los usuarios. */}
        <Route
          path="permissions"
          element={<Navigate to="/admin/roles/permisos" replace />}
        />
        <Route
          path="configuracion"
          element={<Navigate to="/admin/configuracion/identidad" replace />}
        />
        <Route
          path="configuracion/identidad"
          element={
            <RequirePermission permission={CONFIGURACION_VER}>
              <ConfiguracionPage />
            </RequirePermission>
          }
        />
        <Route
          path="configuracion/colores-tipografia"
          element={
            <RequirePermission permission={CONFIGURACION_VER}>
              <ConfiguracionPage />
            </RequirePermission>
          }
        />
        <Route
          path="configuracion/apariencia"
          element={
            <RequirePermission permission={CONFIGURACION_VER}>
              <ConfiguracionPage />
            </RequirePermission>
          }
        />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
