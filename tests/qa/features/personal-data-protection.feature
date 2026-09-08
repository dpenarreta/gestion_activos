Feature: Protección de datos personales
  Como responsable de cumplimiento
  Quiero que los datos personales gestionados por el sistema (nombre, correo,
  usuario, roles, permisos, accesos) solo sean accesibles a quien tiene el
  permiso correspondiente y nunca se filtren por canales no controlados
  Para respetar los principios de finalidad, minimización y acceso restringido
  de la Ley Orgánica de Protección de Datos Personales de Ecuador

  @AC-DP-001
  Scenario: Un usuario sin permisos intenta consultar datos personales
    Given que existe un usuario autenticado sin permiso para consultar usuarios
    When intenta acceder al listado de usuarios
    Then el backend rechaza la solicitud con acceso denegado
    And la respuesta no incluye ningún dato personal

  @AC-DP-002
  Scenario: Los datos personales nunca se registran en logs de acceso
    Given que un usuario inicia sesión y navega el panel administrativo
    When se revisan los logs estructurados del backend
    Then no aparece la contraseña del usuario en ningún registro
    And no aparece ningún token completo

  @AC-DP-003
  Scenario: El registro de auditoría enmascara campos sensibles antes de guardarse
    Given que ocurre un evento de auditoría cuyo payload original incluye un campo sensible
    When el evento se persiste
    Then el valor de ese campo queda reemplazado por un marcador, nunca en texto plano

  @AC-DP-004
  Scenario: Acceso a auditoría con datos personales requiere un permiso adicional al de solo listar
    Given que un usuario tiene el permiso "auditoria.ver" pero no "auditoria.ver_detalle"
    When consulta un evento de auditoría concreto
    Then ve los campos generales del evento
    But no ve los valores anteriores ni nuevos (el detalle con datos personales)

  @AC-DP-005
  Scenario: Un usuario puede consultar cuáles son sus propios permisos y datos
    Given que el usuario está autenticado
    When solicita su propio perfil
    Then recibe únicamente su información pública y sus permisos vigentes

  @AC-DP-006
  Scenario: Deshabilitar una cuenta no elimina físicamente sus datos
    Given que existe un usuario con historial de auditoría asociado
    When un administrador deshabilita la cuenta
    Then los datos y el historial se conservan (baja lógica, no eliminación física)
    And el usuario no puede volver a autenticarse mientras esté deshabilitado
