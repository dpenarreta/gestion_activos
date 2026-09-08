Feature: Autorización basada en el catálogo de permisos
  Como responsable de seguridad del sistema
  Quiero que cada operación administrativa valide un permiso concreto en el backend
  Para que el frontend nunca sea la única barrera de seguridad

  @AC-022 @AC-036
  Scenario: Un usuario sin el permiso requerido recibe 403 y queda auditado
    Given que existe un usuario autenticado sin el permiso "usuarios.ver"
    When intenta acceder al listado de usuarios
    Then el backend rechaza la solicitud con 403
    And registra un evento de auditoría "access_denied" con el permiso requerido

  @AC-036
  Scenario: Un usuario con el permiso adecuado accede correctamente
    Given que existe un usuario con el permiso "usuarios.ver"
    When solicita el listado de usuarios
    Then el backend responde 200 con los datos

  @AC-036
  Scenario: Revocar un permiso surte efecto en la siguiente petición, sin relogin
    Given que un usuario con el permiso "usuarios.ver" ya está autenticado
    When un administrador le retira ese permiso
    And el usuario vuelve a solicitar el listado de usuarios
    Then el backend rechaza la nueva solicitud con 403

  @AC-036
  Scenario: Un superusuario tiene acceso total sin depender del catálogo
    Given que existe un superusuario sin permisos del catálogo asignados explícitamente
    When solicita cualquier recurso administrativo
    Then el backend le concede acceso

  @AC-037
  Scenario: El menú administrativo del frontend solo muestra las opciones autorizadas
    Given que un usuario solo tiene el permiso "roles.ver"
    When inicia sesión en el panel administrativo
    Then el menú lateral muestra únicamente "Roles"
    And no muestra "Usuarios", "Permisos" ni "Configuración"

  @AC-037
  Scenario: Acceder directamente a una URL sin el permiso redirige a la página de acceso denegado
    Given que un usuario no tiene el permiso "usuarios.ver"
    When navega directamente a la sección de usuarios del panel
    Then el frontend lo redirige a la página 403
