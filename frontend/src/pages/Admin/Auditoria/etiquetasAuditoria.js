/*
 * Etiquetas legibles para la acción y el objeto de un evento de auditoría
 * (auditoría UX/UI, fase 2, 28/10/2026). La tabla mostraba `role.created` o
 * `ordentrabajo` tal cual llegan del servidor: se entienden leyendo código,
 * no mirando la pantalla. El código sigue a mano en el `title` de la celda,
 * que es lo que se escribe en el filtro «Acción».
 *
 * Las acciones son libres —cada módulo registra las suyas—, así que no hay un
 * catálogo cerrado: primero se busca la acción entera entre las conocidas y,
 * si no está, se compone con el objeto (lo de antes del último punto) y el
 * verbo (lo último). Lo que no se reconoce se deja como llega: mejor el
 * código que una traducción inventada.
 */

const ACCIONES = {
  "login.success": "Inicio de sesión",
  "login.failed": "Inicio de sesión fallido",
  logout: "Cierre de sesión",
  "user.created": "Usuario creado",
  "user.updated": "Usuario modificado",
  "user.disabled": "Usuario deshabilitado",
  "user.enabled": "Usuario habilitado",
  "user.blocked": "Usuario bloqueado",
  "user.unblocked": "Usuario desbloqueado",
  "user.roles_assigned": "Roles asignados",
  "user.empresas_assigned": "Empresas y roles asignados",
  "user.permissions_assigned": "Permisos asignados",
  "user.sessions_revoked": "Sesiones cerradas",
  "user.password_reset": "Contraseña restablecida",
  "user.password_reset_requested": "Restablecimiento de contraseña pedido",
  "user.password_reset_rejected": "Restablecimiento de contraseña rechazado",
  "user.password_reset_completed": "Contraseña restablecida",
  "user.password_reset_admin_initiated":
    "Restablecimiento de contraseña por un administrador",
  "user.password_reset_temporal": "Clave temporal asignada",
  "user.password_changed_self": "Contraseña cambiada por su dueño",
  "role.created": "Rol creado",
  "role.updated": "Rol modificado",
  "role.deleted": "Rol eliminado",
  "empresa.created": "Empresa creada",
  "empresa.updated": "Empresa modificada",
  "activo.created": "Activo registrado",
  "activo.updated": "Activo modificado",
  "activo.exportado": "Activos exportados",
  "activo.importacion_masiva": "Importación de activos",
  "activo.etiqueta_generada": "Etiqueta de activo generada",
  "mantenimiento.created": "Mantenimiento registrado",
  "mantenimiento.updated": "Mantenimiento modificado",
  "mantenimiento.deleted": "Mantenimiento eliminado",
  "empleado.created": "Empleado registrado",
  "obligation.created": "Obligación creada",
  "obligation.updated": "Obligación modificada",
  "obligation.ficha_updated": "Ficha de obligación modificada",
  "matriz.imported": "Matriz importada",
  "reminder.sent": "Recordatorio enviado",
  "reminder_config.updated": "Recordatorios configurados",
  "report.exported": "Reporte exportado",
  "reporte.exportado": "Reporte exportado",
  "theme.updated": "Apariencia modificada",
  "theme.reset": "Apariencia restablecida",
  "document.accessed": "Documento consultado",
  "respaldo.solicitado": "Respaldo solicitado",
  "respaldo.borrado": "Respaldo borrado",
  "respaldo.politica_changed": "Política de respaldos modificada",
  "plantilla_correo.guardada": "Plantilla de correo guardada",
  "correo.prueba_enviada": "Correo de prueba enviado",
  "alertas.prueba_enviada": "Alerta de prueba enviada",
  "alertas.configuracion_actualizada": "Alertas configuradas",
  "configuracion.texto_legal.actualizado": "Texto legal actualizado",
  "ticket.aprobado": "Ticket aprobado",
};

/** El verbo, lo último del código. */
const VERBOS = {
  created: "creado",
  creado: "creado",
  creada: "creada",
  updated: "modificado",
  actualizado: "actualizado",
  actualizada: "actualizada",
  deleted: "eliminado",
  eliminado: "eliminado",
  eliminada: "eliminada",
  exported: "exportado",
  exportado: "exportado",
  imported: "importado",
  aprobado: "aprobado",
  rechazado: "rechazado",
};

/** Objetos (`target_type` o lo de antes del verbo en la acción). */
const OBJETOS = {
  activo: "Activo",
  user: "Usuario",
  usuario: "Usuario",
  role: "Rol",
  group: "Rol",
  empresa: "Empresa",
  empleado: "Empleado",
  mantenimiento: "Mantenimiento",
  ordentrabajo: "Orden de trabajo",
  ticket: "Ticket",
  reporte: "Reporte",
  report: "Reporte",
  plantilla_correo: "Plantilla de correo",
  politicaobsolescencia: "Política de obsolescencia",
  caracteristicatipo: "Característica del tipo",
  caracteristica_tipo: "Característica del tipo",
  campo_formulario: "Campo de formulario",
  criticidad: "Criticidad",
  dashboard: "Panel",
  endpoint: "Servicio",
  mesa: "Mesa de ayuda",
  tecnico: "Técnico",
  obligation: "Obligación",
  sede: "Sede",
  proveedor: "Proveedor",
  concesionario: "Concesionario",
};

// Para concordar el verbo: «Sede creada», no «Sede creado».
const FEMENINOS = new Set([
  "Empresa",
  "Orden de trabajo",
  "Plantilla de correo",
  "Política de obsolescencia",
  "Característica del tipo",
  "Criticidad",
  "Mesa de ayuda",
  "Obligación",
  "Sede",
]);

function primeraMayuscula(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** «role.created» → «Rol creado»; lo desconocido, tal cual. */
export function etiquetaDeAccion(accion) {
  if (!accion) return "—";
  if (ACCIONES[accion]) return ACCIONES[accion];
  const partes = accion.split(".");
  const verbo = VERBOS[partes.at(-1)];
  const objeto = OBJETOS[partes.at(-2)?.toLowerCase()];
  if (verbo && objeto) {
    const concordado =
      FEMENINOS.has(objeto) && verbo.endsWith("o")
        ? `${verbo.slice(0, -1)}a`
        : verbo;
    return `${objeto} ${concordado}`;
  }
  return accion;
}

/** «ordentrabajo» → «Orden de trabajo»; lo desconocido, tal cual. */
export function etiquetaDeObjeto(tipo) {
  if (!tipo) return "";
  return OBJETOS[tipo.toLowerCase()] ?? primeraMayuscula(tipo);
}

/**
 * Las acciones conocidas para el filtro «Acción», ordenadas por su etiqueta:
 * antes había que escribir el código (`role.created`) que solo se veía en el
 * `title` de la celda (revisión final UX/UI, 28/10/2026). Se envía el código.
 * Dos códigos con la misma etiqueta se distinguen con el código al lado.
 */
export const OPCIONES_DE_ACCION = (() => {
  const repetidas = new Map();
  for (const etiqueta of Object.values(ACCIONES)) {
    repetidas.set(etiqueta, (repetidas.get(etiqueta) ?? 0) + 1);
  }
  return Object.entries(ACCIONES)
    .map(([codigo, etiqueta]) => ({
      codigo,
      etiqueta:
        repetidas.get(etiqueta) > 1 ? `${etiqueta} (${codigo})` : etiqueta,
    }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
})();

/**
 * Nombres de campo que llegan en «antes» y «después» (revisión final UX/UI,
 * 28/10/2026): `first_name` o `is_active` se entienden leyendo código. Los
 * valores son JSON libre de cada módulo, así que se traduce lo común y lo
 * desconocido se deja como llega.
 */
const CAMPOS = {
  id: "Identificador",
  username: "Usuario",
  email: "Correo",
  first_name: "Nombres",
  last_name: "Apellidos",
  full_name: "Nombre completo",
  name: "Nombre",
  nombre: "Nombre",
  codigo: "Código",
  codigo_empleado: "Código de empleado",
  descripcion: "Descripción",
  status: "Estado",
  estado: "Estado",
  is_active: "Activo",
  activo: "Activo",
  activa: "Activa",
  is_superuser: "Superusuario",
  is_staff: "Personal administrativo",
  roles: "Roles",
  role: "Rol",
  permissions: "Permisos",
  permission_codenames: "Permisos",
  empresa: "Empresa",
  empresas: "Empresas",
  departamento: "Departamento",
  cargo: "Cargo",
  sede: "Sede",
  proveedor: "Proveedor",
  custodio: "Custodio",
  tipo_dispositivo: "Tipo de dispositivo",
  numero_serie: "Número de serie",
  serie: "Serie",
  marca: "Marca",
  modelo: "Modelo",
  identificacion: "Identificación",
  telefono: "Teléfono",
  direccion: "Dirección",
  ciudad: "Ciudad",
  fecha: "Fecha",
  motivo: "Motivo",
  observaciones: "Observaciones",
  site_name: "Nombre del sitio",
  must_change_password: "Debe cambiar la contraseña",
  last_login: "Último ingreso",
  created_at: "Creado",
  updated_at: "Modificado",
};

/** «first_name» → «Nombres»; lo desconocido, tal cual. */
export function etiquetaDeCampo(campo) {
  return CAMPOS[campo] ?? campo;
}
