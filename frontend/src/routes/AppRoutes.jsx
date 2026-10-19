import { CorreoDelSistemaPage } from "../pages/Admin/Configuracion/CorreoDelSistemaPage";
import { NotificacionesAlertasPage } from "../pages/Admin/Configuracion/NotificacionesAlertasPage";
import { PlantillaCorreoEditor } from "../pages/Admin/Configuracion/PlantillaCorreoEditor";
import { PlantillasCorreoPage } from "../pages/Admin/Configuracion/PlantillasCorreoPage";
import { AuditoriaInicio } from "../components/admin/AuditoriaMarco/AuditoriaMarco";
import { ReportesInicio } from "../components/admin/ReportesMarco/ReportesMarco";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { InicioDeConfiguracion } from "../components/admin/ConfiguracionMarco/InicioDeConfiguracion";
import { CatalogoMatrizPage } from "../pages/Matriz/CatalogoMatrizPage";
import { AuditoriaMatriz } from "../pages/Matriz/AuditoriaMatriz";
import { CalendarioMatriz } from "../pages/Matriz/CalendarioMatriz";
import { ConfiguracionRecordatoriosPage } from "../pages/Matriz/ConfiguracionRecordatoriosPage";
import { DocumentosMatriz } from "../pages/Matriz/DocumentosMatriz";
import { MatrizObligacionesPage } from "../pages/Matriz/MatrizObligacionesPage";
import { ReportesMatriz } from "../pages/Matriz/ReportesMatriz";
import { RequiereRolMatriz } from "../pages/Matriz/RequiereRolMatriz";
import { ResumenMatriz } from "../pages/Matriz/ResumenMatriz";
import { OrdenDetalle } from "../pages/Ordenes/OrdenDetalle";
import { Bandeja } from "../pages/Soporte/Bandeja";
import {
  CategoriasSoporte,
  EquipoSoporte,
  HorarioMesaSoporte,
  RespuestasSoporte,
  SlaSoporte,
} from "../pages/Soporte/Configuracion/ConfiguracionSoporte";
import { AprobacionesPage } from "../pages/Aprobaciones/AprobacionesPage";
import { NotificacionesPage } from "../pages/Notificaciones/NotificacionesPage";
import { FormularioEditor } from "../pages/Soporte/FormularioEditor";
import { HorasFuera } from "../pages/Soporte/HorasFuera";
import { MiHorario } from "../pages/Soporte/MiHorario";
import { RegistrarTicket } from "../pages/Soporte/RegistrarTicket";
import { FormularioSoporte } from "../pages/Soporte/Publico/FormularioSoporte";
import { SeguimientoTicket } from "../pages/Soporte/Publico/SeguimientoTicket";
import { ReportesSoporte } from "../pages/Soporte/ReportesSoporte";
import { TicketDetalle } from "../pages/Soporte/TicketDetalle";
import { OrdenForm } from "../pages/Ordenes/OrdenForm";
import { OrdenesList } from "../pages/Ordenes/OrdenesList";
import { PanelOrdenes } from "../pages/Ordenes/PanelOrdenes";
import { ReportesOrdenes } from "../pages/Ordenes/ReportesOrdenes";
import {
  DashboardsDetalle,
  DashboardsHistorico,
  DashboardsListado,
  DashboardsPlantillaBase,
} from "../dashboards/paginas";
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
import { CategoriasList } from "../pages/Admin/Activos/CategoriasList";
import { TiposDispositivoList } from "../pages/Admin/Activos/TiposDispositivoList";
import { ConfiguracionPage } from "../pages/Admin/Configuracion/ConfiguracionPage";
import { RespaldosPage } from "../pages/Admin/Configuracion/RespaldosPage";
import { EmpresaForm } from "../pages/Admin/Empresas/EmpresaForm";
import { EmpresasList } from "../pages/Admin/Empresas/EmpresasList";
import { ComponentesList } from "../pages/Admin/Mantenimientos/ComponentesList";
import { MantenimientoForm } from "../pages/Admin/Mantenimientos/MantenimientoForm";
import { MantenimientosList } from "../pages/Admin/Mantenimientos/MantenimientosList";
import { AlertasPage } from "../pages/Admin/Alertas/AlertasPage";
import { PoliticasPage } from "../pages/Admin/Politicas/PoliticasPage";
import { SugerenciasPage } from "../pages/Admin/Politicas/SugerenciasPage";
import { CargaCatalogosPage } from "../pages/Admin/CargaCatalogos/CargaCatalogosPage";
import { DepartamentoForm } from "../pages/Admin/Organizacion/DepartamentoForm";
import { DepartamentosList } from "../pages/Admin/Organizacion/DepartamentosList";
import { ReportesPage } from "../pages/Admin/Reportes/ReportesPage";
import { MisSolicitudes } from "../pages/Admin/Solicitudes/MisSolicitudes";
import { SolicitudDetalle } from "../pages/Admin/Solicitudes/SolicitudDetalle";
import { SolicitudForm } from "../pages/Admin/Solicitudes/SolicitudForm";
import { SolicitudesRecibidas } from "../pages/Admin/Solicitudes/SolicitudesRecibidas";
import { MisEquiposPage } from "../pages/Admin/MisEquipos/MisEquiposPage";
import { InicioDelPanel } from "./InicioDelPanel";
import { ConcesionarioForm } from "../pages/Admin/Organizacion/ConcesionarioForm";
import { ConcesionariosList } from "../pages/Admin/Organizacion/ConcesionariosList";
import { ProveedorForm } from "../pages/Admin/Organizacion/ProveedorForm";
import { ProveedoresList } from "../pages/Admin/Organizacion/ProveedoresList";
import { SedeForm } from "../pages/Admin/Organizacion/SedeForm";
import { SedesList } from "../pages/Admin/Organizacion/SedesList";
import { AuditoriaList } from "../pages/Admin/Auditoria/AuditoriaList";
import { EmpleadoForm } from "../pages/Admin/Organizacion/EmpleadoForm";
import { EmpleadosList } from "../pages/Admin/Organizacion/EmpleadosList";
import { RoleForm } from "../pages/Admin/Roles/RoleForm";
import { RolesPage } from "../pages/Admin/Roles/RolesPage";
import { UserForm } from "../pages/Admin/Users/UserForm";
import { UsersList } from "../pages/Admin/Users/UsersList";

const USUARIOS_VER = "usuarios.ver";
const AUDITORIA_VER = "auditoria.ver";
const ROLES_VER = "roles.ver";
const PERMISOS_VER = "permisos.ver";
const CONFIGURACION_VER = "configuracion.ver";
const EMPRESAS_VER = "empresas.ver";
const ORGANIZACION_VER = "organizacion.ver";
const ACTIVOS_VER = "activos.ver";
const MANTENIMIENTOS_VER = "mantenimientos.ver";
const ALERTAS_VER = "alertas.ver";
const POLITICAS_VER = "politicas.ver";
const SOLICITUDES_VER = "solicitudes.ver";
const SOLICITUDES_CREAR = "solicitudes.crear";
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
      {/* El registro público se retiró (revisión de seguridad, H-03):
          las cuentas las crea un administrador desde Usuarios, con su
          empresa y su rol. */}
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* Mesa de ayuda: el formulario de cada empresa y el seguimiento por
          enlace secreto, sin iniciar sesión. */}
      <Route
        path="/soporte/seguimiento/:token"
        element={<SeguimientoTicket />}
      />
      <Route path="/soporte/:codigo" element={<FormularioSoporte />} />
      <Route
        path={CHANGE_PASSWORD_REQUIRED_PATH}
        element={<ChangePasswordRequired />}
      />
      <Route path="/403" element={<Forbidden />} />

      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<InicioDelPanel />} />
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
          path="auditoria"
          element={
            <AuditoriaInicio>
              <RequirePermission permission={AUDITORIA_VER}>
                <AuditoriaList />
              </RequirePermission>
            </AuditoriaInicio>
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
        {/* Su permiso es `activos.ver_asignados`, no `activos.ver`: es lo que
            separa al usuario final de quien opera el inventario. */}
        <Route
          path="mis-equipos"
          element={
            <RequirePermission permission="activos.ver_asignados">
              <MisEquiposPage />
            </RequirePermission>
          }
        />
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
          path="activos/categorias"
          element={
            <RequirePermission permission={ACTIVOS_VER}>
              <CategoriasList />
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
        {/* Las fijas antes que ":id", como en activos y mantenimientos: sin
            eso, «nueva» entraría por la ficha y pediría la solicitud número
            «nueva». */}
        <Route
          path="solicitudes/mias"
          element={
            <RequirePermission permission={SOLICITUDES_VER}>
              <MisSolicitudes />
            </RequirePermission>
          }
        />
        <Route
          path="solicitudes/recibidas"
          element={
            <RequirePermission permission={SOLICITUDES_VER}>
              <SolicitudesRecibidas />
            </RequirePermission>
          }
        />
        <Route
          path="solicitudes/nueva"
          element={
            <RequirePermission permission={SOLICITUDES_CREAR}>
              <SolicitudForm />
            </RequirePermission>
          }
        />
        <Route
          path="solicitudes/:id"
          element={
            <RequirePermission permission={SOLICITUDES_VER}>
              <SolicitudDetalle />
            </RequirePermission>
          }
        />
        <Route
          path="solicitudes"
          element={<Navigate to="/admin/solicitudes/mias" replace />}
        />
        <Route
          path="configuracion/plantilla-dashboards"
          element={
            <RequirePermission permission={CONFIGURACION_VER}>
              <DashboardsPlantillaBase />
            </RequirePermission>
          }
        />
        {/* Dashboards de cada área o departamento de la empresa. El listado pide el permiso
            del módulo; un dashboard puede abrirse también por su lista de
            roles, y eso lo decide el servidor (la pantalla muestra su 403). */}
        {/* Mantenimiento de sedes: órdenes de trabajo. Qué órdenes ve cada
            quien lo decide el servidor (todas, o las suyas, las asignadas y
            las de las sedes a su cargo). */}
        <Route
          path="ordenes"
          element={<Navigate to="/admin/ordenes/panel" replace />}
        />
        {/* Las notificaciones de la campana: cada quien las suyas. */}
        <Route path="notificaciones" element={<NotificacionesPage />} />
        {/* Aprobaciones: llega quien debe dar el visto bueno, aunque no
            tenga permisos de la mesa (lo decide el servidor). */}
        <Route path="aprobaciones" element={<AprobacionesPage />} />
        {/* Mesa de ayuda. Qué tickets ve cada quien lo decide el servidor. */}
        <Route
          path="soporte"
          element={<Navigate to="/admin/soporte/bandeja" replace />}
        />
        <Route path="soporte/bandeja" element={<Bandeja />} />
        <Route
          path="soporte/todos"
          element={
            <RequirePermission permission="soporte.ver_todos">
              <Bandeja todos />
            </RequirePermission>
          }
        />
        <Route path="soporte/tickets/:id" element={<TicketDetalle />} />
        <Route path="soporte/registrar" element={<RegistrarTicket />} />
        <Route
          path="soporte/mi-horario"
          element={
            <RequirePermission permission="soporte.atender">
              <MiHorario />
            </RequirePermission>
          }
        />
        <Route path="soporte/horas" element={<HorasFuera />} />
        <Route
          path="soporte/formulario"
          element={
            <RequirePermission permission="soporte.configurar">
              <FormularioEditor />
            </RequirePermission>
          }
        />
        <Route
          path="configuracion/soporte"
          element={
            <RequirePermission permission="soporte.configurar">
              <EquipoSoporte />
            </RequirePermission>
          }
        />
        <Route
          path="configuracion/soporte/categorias"
          element={
            <RequirePermission permission="soporte.configurar">
              <CategoriasSoporte />
            </RequirePermission>
          }
        />
        <Route
          path="configuracion/soporte/sla"
          element={
            <RequirePermission permission="soporte.configurar">
              <SlaSoporte />
            </RequirePermission>
          }
        />
        <Route
          path="configuracion/soporte/horario"
          element={
            <RequirePermission permission="soporte.configurar">
              <HorarioMesaSoporte />
            </RequirePermission>
          }
        />
        <Route
          path="configuracion/soporte/respuestas"
          element={
            <RequirePermission permission="soporte.configurar">
              <RespuestasSoporte />
            </RequirePermission>
          }
        />
        <Route
          path="ordenes/lista"
          element={
            <RequirePermission permission="ordenes.ver">
              <OrdenesList />
            </RequirePermission>
          }
        />
        <Route
          path="ordenes/panel"
          element={
            <RequirePermission permission="ordenes.ver">
              <PanelOrdenes />
            </RequirePermission>
          }
        />
        <Route
          path="ordenes/lista/nueva"
          element={
            <RequirePermission permission="ordenes.crear">
              <OrdenForm />
            </RequirePermission>
          }
        />
        <Route
          path="ordenes/lista/:id"
          element={
            <RequirePermission permission="ordenes.ver">
              <OrdenDetalle />
            </RequirePermission>
          }
        />
        <Route
          path="dashboards"
          element={
            <RequirePermission permission="dashboard.view">
              <DashboardsListado />
            </RequirePermission>
          }
        />
        <Route path="dashboards/:dashboardId" element={<DashboardsDetalle />} />
        <Route
          path="dashboards/:dashboardId/historico"
          element={<DashboardsHistorico />}
        />
        <Route
          path="configuracion/respaldos"
          element={
            <RequirePermission permission={CONFIGURACION_VER}>
              <RespaldosPage />
            </RequirePermission>
          }
        />
        <Route
          path="politicas"
          element={
            <RequirePermission permission={POLITICAS_VER}>
              <PoliticasPage />
            </RequirePermission>
          }
        />
        {/* Depreciación y renovación comparten pantalla y permiso: las dos son
            reglas de cuánto dura un equipo, contadas con números distintos. */}
        <Route
          path="politicas/depreciacion"
          element={
            <RequirePermission permission={POLITICAS_VER}>
              <PoliticasPage seccion="depreciacion" />
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
        {/* Reportes, uno solo para todo el sistema: inventario en su
            dirección de siempre y la Matriz como otra pestaña. */}
        <Route
          path="reportes"
          element={
            <ReportesInicio>
              <ReportesPage />
            </ReportesInicio>
          }
        />
        <Route
          path="reportes/soporte"
          element={
            <RequirePermission permission="soporte.reportes">
              <ReportesSoporte />
            </RequirePermission>
          }
        />
        <Route
          path="reportes/ordenes"
          element={
            <RequirePermission permission="ordenes.reportes">
              <ReportesOrdenes />
            </RequirePermission>
          }
        />
        <Route
          path="reportes/matriz"
          element={
            <RequiereRolMatriz>
              <ReportesMatriz />
            </RequiereRolMatriz>
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
          path="organizacion/concesionarios"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <ConcesionariosList />
            </RequirePermission>
          }
        />
        <Route
          path="organizacion/concesionarios/new"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <ConcesionarioForm />
            </RequirePermission>
          }
        />
        <Route
          path="organizacion/concesionarios/:id"
          element={
            <RequirePermission permission={ORGANIZACION_VER}>
              <ConcesionarioForm />
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
        <Route path="configuracion" element={<InicioDeConfiguracion />} />
        {/* Matriz de obligaciones: su propio prefijo, como pide la
            especificación del módulo. Sus permisos se comprueban en el
            servidor por empresa; la pantalla dice si no hay rol. */}
        <Route
          path="matriz"
          element={<Navigate to="/admin/matriz/resumen" replace />}
        />
        <Route path="matriz/resumen" element={<ResumenMatriz />} />
        <Route
          path="matriz/obligaciones"
          element={
            <RequiereRolMatriz>
              <MatrizObligacionesPage />
            </RequiereRolMatriz>
          }
        />
        <Route
          path="matriz/documentos"
          element={
            <RequiereRolMatriz>
              <DocumentosMatriz />
            </RequiereRolMatriz>
          }
        />
        <Route
          path="matriz/calendario"
          element={
            <RequiereRolMatriz>
              <CalendarioMatriz />
            </RequiereRolMatriz>
          }
        />
        {/* La dirección anterior de los reportes de la Matriz, por los
            enlaces guardados. */}
        <Route
          path="matriz/reportes"
          element={<Navigate to="/admin/reportes/matriz" replace />}
        />
        {/* La auditoría de la Matriz: el servidor exige `ver_auditoria` en
            la empresa activa y la pantalla muestra su mensaje si falta. */}
        <Route
          path="auditoria/matriz"
          element={
            <RequiereRolMatriz>
              <AuditoriaMatriz />
            </RequiereRolMatriz>
          }
        />
        <Route
          path="configuracion/notificaciones"
          element={
            <RequirePermission permission="configuracion.ver">
              <CorreoDelSistemaPage />
            </RequirePermission>
          }
        />
        <Route
          path="configuracion/notificaciones/plantillas"
          element={
            <RequirePermission permission="configuracion.ver">
              <PlantillasCorreoPage />
            </RequirePermission>
          }
        />
        <Route
          path="configuracion/notificaciones/plantillas/:clave"
          element={
            <RequirePermission permission="configuracion.ver">
              <PlantillaCorreoEditor />
            </RequirePermission>
          }
        />
        <Route
          path="configuracion/notificaciones/alertas"
          element={
            <RequirePermission permission="notificaciones.configurar">
              <NotificacionesAlertasPage />
            </RequirePermission>
          }
        />
        <Route
          path="configuracion/recordatorios"
          element={<ConfiguracionRecordatoriosPage />}
        />
        {/* Catálogos de la Matriz: viven en Configuración → Catálogos, junto
            a los del inventario, con su propio permiso. */}
        <Route
          path="catalogos/areas"
          element={
            <RequirePermission permission="catalogos.ver">
              <CatalogoMatrizPage key="areas" tipo="areas" />
            </RequirePermission>
          }
        />
        <Route
          path="catalogos/entidades-control"
          element={
            <RequirePermission permission="catalogos.ver">
              <CatalogoMatrizPage key="entidades" tipo="entidades-control" />
            </RequirePermission>
          }
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
