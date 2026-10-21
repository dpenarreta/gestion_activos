import { CorreoDelSistemaPage } from "../pages/Admin/Configuracion/CorreoDelSistemaPage";
import { NotificacionesAlertasPage } from "../pages/Admin/Configuracion/NotificacionesAlertasPage";
import { PlantillaCorreoEditor } from "../pages/Admin/Configuracion/PlantillaCorreoEditor";
import { PlantillasCorreoPage } from "../pages/Admin/Configuracion/PlantillasCorreoPage";
import { AuditoriaInicio } from "../components/admin/AuditoriaMarco/AuditoriaMarco";
import { ReportesInicio } from "../components/admin/ReportesMarco/ReportesMarco";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { InicioDeConfiguracion } from "../components/admin/ConfiguracionMarco/InicioDeConfiguracion";
import { CatalogoMatrizPage } from "../pages/Matriz/CatalogoMatrizPage";
import { CalendarioMatriz } from "../pages/Matriz/CalendarioMatriz";
import { ConfiguracionRecordatoriosPage } from "../pages/Matriz/ConfiguracionRecordatoriosPage";
import { DocumentosMatriz } from "../pages/Matriz/DocumentosMatriz";
import { MatrizObligacionesPage } from "../pages/Matriz/MatrizObligacionesPage";
import { ReportesMatriz } from "../pages/Matriz/ReportesMatriz";
import { RequiereRolMatriz } from "../pages/Matriz/RequiereRolMatriz";
import { PERMISOS_MATRIZ } from "../modulos/permisosMatriz";
import { ResumenMatriz } from "../pages/Matriz/ResumenMatriz";
import { OrdenDetalle } from "../pages/Ordenes/OrdenDetalle";
import { CodigosConductaPage } from "../pages/Institucional/CodigosConductaPage";
import { EstructuraPage } from "../pages/Institucional/EstructuraPage";
import { FlujosPermisoPage } from "../pages/Institucional/FlujosPermisoPage";
import { MiOnboardingPage } from "../pages/Institucional/MiOnboardingPage";
import { ObservacionesRolPage } from "../pages/Institucional/ObservacionesRolPage";
import { RolPagosPage } from "../pages/Institucional/RolPagosPage";
import { SolicitudPermisosPage } from "../pages/Institucional/SolicitudPermisosPage";
import { SugerenciasPage as SugerenciasErroresPage } from "../pages/Institucional/SugerenciasPage";
import { GestionCalendarioPage } from "../pages/Institucional/GestionCalendarioPage";
import { GestionDocumentosPage } from "../pages/Institucional/GestionDocumentosPage";
import { GestionNoticiasPage } from "../pages/Institucional/GestionNoticiasPage";
import { InicioInstitucional } from "../pages/Institucional/InicioInstitucional";
import { MisVacacionesPage } from "../pages/Institucional/MisVacacionesPage";
import {
  PERMISOS_CODIGOS,
  PERMISOS_INSTITUCIONAL,
} from "../modulos/permisosInstitucional";
import { OrganigramaPage } from "../pages/Institucional/OrganigramaPage";
import { Bandeja } from "../pages/Soporte/Bandeja";
import { AvisoInicioPage } from "../pages/Admin/Configuracion/AvisoInicioPage";
import { ModulosPage } from "../pages/Admin/Configuracion/ModulosPage";
import {
  CategoriasSoporte,
  EquipoSoporte,
  HorarioMesaSoporte,
  RespuestasSoporte,
  SlaSoporte,
} from "../pages/Soporte/Configuracion/ConfiguracionSoporte";
import { AprobacionesPage } from "../pages/Aprobaciones/AprobacionesPage";
import { ChatPage } from "../pages/Chat/ChatPage";
import { NotificacionesPage } from "../pages/Notificaciones/NotificacionesPage";
import { FormularioEditor } from "../pages/Soporte/FormularioEditor";
import { HorasFuera } from "../pages/Soporte/HorasFuera";
import { MiHorario } from "../pages/Soporte/MiHorario";
import { RegistrarTicket } from "../pages/Soporte/RegistrarTicket";
import { AyudaPage } from "../pages/Ayuda/AyudaPage";
import { MiTicket } from "../pages/Ayuda/MiTicket";
import { MisDatosPage } from "../pages/MisDatos/MisDatosPage";
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
      {/* Desde el 20/10/2026 la mesa de ayuda es solo para personas con sesión:
          los enlaces viejos (formulario público y seguimiento sin sesión)
          llevan a «Soporte TI», que pide iniciar sesión. */}
      <Route
        path="/soporte/seguimiento/:token"
        element={<Navigate to="/admin/ayuda" replace />}
      />
      <Route
        path="/soporte/:codigo"
        element={<Navigate to="/admin/ayuda" replace />}
      />
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
            <RequirePermission permission={"usuarios.crear"}>
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
            <RequirePermission permission={"empresas.editar"}>
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
              <AuditoriaList />
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
            <RequirePermission permission={"roles.editar"}>
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
            <RequirePermission permission={"activos.crear"}>
              <ImportarActivosPage seccion="cargar" />
            </RequirePermission>
          }
        />
        <Route
          path="activos/importar/columnas"
          element={
            <RequirePermission permission={"activos.editar"}>
              <ImportarActivosPage seccion="columnas" />
            </RequirePermission>
          }
        />
        <Route
          path="activos/new"
          element={
            <RequirePermission permission={"activos.crear"}>
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
            <RequirePermission permission={"activos.editar"}>
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
            <RequirePermission permission={"mantenimientos.registrar"}>
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
        {/* Órdenes de trabajo (mantenimiento de sedes y agencias). Qué órdenes ve cada
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
        {/* Soporte TI (botón de la barra superior) y Mi perfil (menú del
            usuario, abajo): toda persona con sesión, sin permisos. */}
        <Route path="ayuda" element={<AyudaPage />} />
        <Route path="ayuda/tickets/:id" element={<MiTicket />} />
        <Route path="perfil" element={<MisDatosPage />} />
        <Route
          path="mis-datos"
          element={<Navigate to="/admin/perfil" replace />}
        />
        {/* El chat de la empresa: toda persona con sesión, sin permisos. */}
        <Route path="chat" element={<ChatPage />} />
        {/* Institucional: el organigrama, su estructura y los cargos. */}
        <Route
          path="institucional"
          element={<Navigate to="/admin/institucional/inicio" replace />}
        />
        {/* Inicio: toda persona con sesión, sin permisos. */}
        <Route path="institucional/inicio" element={<InicioInstitucional />} />
        {/* El calendario de Inicio: gestionarlo pide su permiso. */}
        <Route
          path="institucional/calendario"
          element={
            <RequirePermission permission="calendario.gestionar">
              <GestionCalendarioPage />
            </RequirePermission>
          }
        />
        {/* El carrusel de Inicio: gestionarlo pide su permiso. */}
        <Route
          path="institucional/noticias"
          element={
            <RequirePermission permission="noticias.gestionar">
              <GestionNoticiasPage />
            </RequirePermission>
          }
        />
        {/* Solicitud de permisos: pedir pide `licencias.solicitar` (todos los
            roles de nivel lo tienen); aprobar lo que a uno le toca, no. */}
        <Route
          path="institucional/permisos"
          element={
            <RequirePermission
              permission={["licencias.solicitar", "licencias.ver_todas"]}
            >
              <SolicitudPermisosPage />
            </RequirePermission>
          }
        />
        <Route
          path="institucional/permisos/flujos"
          element={
            <RequirePermission permission="licencias.configurar">
              <FlujosPermisoPage />
            </RequirePermission>
          }
        />
        {/* Mis vacaciones: cada persona las suyas, sin permiso. */}
        <Route
          path="institucional/vacaciones"
          element={<MisVacacionesPage />}
        />
        {/* Códigos de conducta: los lee toda persona con sesión. */}
        <Route path="institucional/codigos" element={<CodigosConductaPage />} />
        {/* Consultar rol de pagos: el suyo con `roles_pago.consultar`. */}
        <Route
          path="institucional/rol-pagos"
          element={
            <RequirePermission
              permission={[
                "roles_pago.consultar",
                "roles_pago.consultar_todos",
                "roles_pago.historial",
              ]}
            >
              <RolPagosPage />
            </RequirePermission>
          }
        />
        <Route
          path="institucional/rol-pagos/observaciones"
          element={
            <RequirePermission permission="roles_pago.observaciones">
              <ObservacionesRolPage />
            </RequirePermission>
          }
        />
        {/* Mi onboarding: toda persona, su plan de capacitación. */}
        <Route path="institucional/onboarding" element={<MiOnboardingPage />} />
        {/* Sugerencias y errores: reportar y gestionar, cada uno con su permiso. */}
        <Route
          path="institucional/sugerencias"
          element={
            <RequirePermission
              permission={["sugerencias.reportar", "sugerencias.gestionar"]}
            >
              <SugerenciasErroresPage />
            </RequirePermission>
          }
        />
        {/* Herramientas y licencias se gestiona desde Editar estructura. */}
        <Route
          path="institucional/herramientas"
          element={
            <Navigate
              to="/admin/institucional/estructura?pestana=herramientas"
              replace
            />
          }
        />
        {/* Gestionarlos (publicar, editar, borrar) sí pide permiso. */}
        <Route
          path="institucional/codigos/gestionar"
          element={
            <RequirePermission permission={PERMISOS_CODIGOS}>
              <GestionDocumentosPage />
            </RequirePermission>
          }
        />
        <Route
          path="institucional/organigrama"
          element={
            <RequirePermission permission={PERMISOS_INSTITUCIONAL}>
              <OrganigramaPage />
            </RequirePermission>
          }
        />
        <Route
          path="institucional/estructura"
          element={
            <RequirePermission
              permission={[
                "institucional.editar",
                "institucional.asignar",
                "institucional.perfil_cargo",
                "herramientas.gestionar",
                "capacitacion.gestionar",
                "capacitacion.resultados",
              ]}
            >
              <EstructuraPage />
            </RequirePermission>
          }
        />
        {/* La asignación de cargos pasó a ser una pestaña de Estructura. */}
        <Route
          path="institucional/asignaciones"
          element={
            <Navigate
              to="/admin/institucional/estructura?pestana=asignaciones"
              replace
            />
          }
        />
        {/* Mesa de ayuda. Qué tickets ve cada quien lo decide el servidor. */}
        <Route
          path="soporte"
          element={<Navigate to="/admin/soporte/bandeja" replace />}
        />
        {/* La Bandeja es de toda persona: «Mis solicitudes» muestra lo que
            creó; las pestañas del equipo dependen de sus permisos. */}
        <Route path="soporte/bandeja" element={<Bandeja />} />
        <Route
          path="soporte/todos"
          element={
            <RequirePermission permission="soporte.ver_todos">
              <Bandeja todos />
            </RequirePermission>
          }
        />
        <Route
          path="soporte/tickets/:id"
          element={
            <RequirePermission
              permission={[
                "soporte.atender",
                "soporte.ver_todos",
                "soporte.asignar",
                "soporte.registrar",
              ]}
            >
              <TicketDetalle />
            </RequirePermission>
          }
        />
        <Route
          path="soporte/registrar"
          element={
            <RequirePermission permission="soporte.registrar">
              <RegistrarTicket />
            </RequirePermission>
          }
        />
        <Route
          path="soporte/mi-horario"
          element={
            <RequirePermission permission="soporte.atender">
              <MiHorario />
            </RequirePermission>
          }
        />
        <Route
          path="soporte/horas"
          element={
            <RequirePermission
              permission={["soporte.atender", "soporte.aprobar_horas"]}
            >
              <HorasFuera />
            </RequirePermission>
          }
        />
        <Route
          path="soporte/formulario"
          element={
            <RequirePermission permission="soporte.formulario">
              <FormularioEditor />
            </RequirePermission>
          }
        />
        <Route
          path="configuracion/modulos"
          element={
            <RequirePermission permission="configuracion.modulos">
              <ModulosPage />
            </RequirePermission>
          }
        />
        <Route
          path="configuracion/aviso-inicio"
          element={
            <RequirePermission permission="configuracion.aviso_inicio">
              <AvisoInicioPage />
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
        <Route
          path="dashboards/:dashboardId"
          element={
            <RequirePermission permission={"dashboard.view"}>
              <DashboardsDetalle />
            </RequirePermission>
          }
        />
        <Route
          path="dashboards/:dashboardId/historico"
          element={
            <RequirePermission permission={"dashboard.view"}>
              <DashboardsHistorico />
            </RequirePermission>
          }
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
        {/* Los departamentos son las unidades del organigrama (21/10/2026):
            se gestionan en Editar estructura. */}
        <Route
          path="organizacion/departamentos/*"
          element={
            <Navigate
              to="/admin/institucional/estructura?pestana=unidades"
              replace
            />
          }
        />
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
            <RequirePermission permission={"organizacion.editar"}>
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
            <RequirePermission permission={"organizacion.editar"}>
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
            <RequirePermission permission={"organizacion.editar"}>
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
            <RequirePermission permission={"organizacion.editar"}>
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
        <Route
          path="matriz/resumen"
          element={
            <RequiereRolMatriz>
              <ResumenMatriz />
            </RequiereRolMatriz>
          }
        />
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
        {/* La auditoría de la Matriz ya no es una pestaña aparte: es una
            opción del filtro «Módulo» de la Auditoría unificada. */}
        <Route
          path="auditoria/matriz"
          element={<Navigate to="/admin/auditoria?modulo=matriz" replace />}
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
          element={
            <RequirePermission permission={PERMISOS_MATRIZ}>
              <ConfiguracionRecordatoriosPage />
            </RequirePermission>
          }
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
