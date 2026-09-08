Feature: Catálogo de permisos
  Como administrador del sistema
  Quiero consultar qué permisos existen y a qué módulo pertenece cada uno
  Para entender qué puede otorgar cada rol antes de asignarlo

  @AC-036
  Scenario: Consultar el catálogo completo de permisos
    Given que existe un usuario con el permiso "permisos.ver"
    When solicita el catálogo de permisos
    Then recibe todos los módulos (usuarios, roles, permisos, configuración, auditoría)
    And cada permiso incluye su identificador estable ("modulo.accion") y su descripción

  @AC-036
  Scenario: Un usuario sin permiso no puede consultar el catálogo
    Given que existe un usuario sin el permiso "permisos.ver"
    When intenta consultar el catálogo de permisos
    Then el backend rechaza la solicitud con 403

  @AC-036
  Scenario: Requiere autenticación
    When se solicita el catálogo de permisos sin sesión iniciada
    Then el backend responde 401

  @AC-PERM-001
  Scenario: El catálogo es de solo lectura
    Given que un usuario tiene el permiso "permisos.ver"
    When intenta modificar el catálogo directamente
    Then no existe ningún endpoint de escritura disponible para ese recurso

  @AC-PERM-002
  Scenario: La página de Permisos del panel administrativo es de solo consulta
    Given que un usuario con el permiso "permisos.ver" abre la página de Permisos
    Then ve el catálogo agrupado por módulo
    But no encuentra controles para seleccionar o guardar cambios
