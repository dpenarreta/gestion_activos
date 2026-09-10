Feature: Administración de usuarios
  Como administrador del sistema
  Quiero gestionar las cuentas de usuario
  Para controlar quién puede acceder al sistema y con qué datos

  Background:
    Given que existe un administrador con permisos completos de usuarios

  @AC-027
  Scenario: Crear un usuario correctamente
    When el administrador crea un usuario con datos válidos
    Then el usuario queda registrado con la contraseña hasheada
    And se registra un evento de auditoría "user.created"

  @AC-027
  Scenario: No se puede crear un usuario con un correo ya registrado
    Given que ya existe un usuario con el correo "existente@example.com"
    When el administrador intenta crear otro usuario con ese mismo correo
    Then el sistema rechaza la solicitud
    And no se crea ningún usuario nuevo

  @AC-028
  Scenario: Editar los datos de perfil de un usuario
    Given que existe un usuario "target"
    When el administrador edita su nombre
    Then el cambio queda guardado
    And se registra un evento de auditoría "user.updated" con el valor anterior y el nuevo

  @AC-029
  Scenario: Deshabilitar un usuario activo
    Given que existe un usuario activo con una sesión abierta
    When el administrador lo deshabilita
    Then el estado del usuario pasa a "disabled"
    And sus sesiones activas quedan revocadas
    And ya no puede iniciar sesión

  @AC-029
  Scenario: Habilitar un usuario deshabilitado
    Given que existe un usuario deshabilitado
    When el administrador lo habilita
    Then el estado del usuario pasa a "active"
    And puede volver a iniciar sesión

  @AC-038
  Scenario: No se puede deshabilitar al último administrador activo
    Given que existe un único administrador activo (superusuario) en el sistema
    When se intenta deshabilitar a ese administrador
    Then el sistema rechaza la operación
    And el administrador permanece activo

  @AC-038
  Scenario: No se puede bloquear al último administrador activo
    Given que existe un único administrador activo en el sistema
    When se intenta bloquear a ese administrador
    Then el sistema rechaza la operación

  @AC-038
  Scenario: Sí se puede deshabilitar a un administrador si existe otro activo
    Given que existen dos administradores activos
    When se deshabilita a uno de ellos
    Then la operación se completa correctamente
    And el otro administrador sigue activo

  @AC-038
  Scenario: Un usuario sin privilegios de administrador se puede deshabilitar libremente
    Given que existe un usuario común, sin ser administrador
    When el administrador lo deshabilita
    Then la operación se completa sin restricciones

  @AC-039
  Scenario: El listado de usuarios nunca expone hashes ni tokens
    Given que existen usuarios registrados
    When se consulta el listado administrativo de usuarios
    Then ninguna respuesta incluye contraseñas, hashes, tokens ni secretos

  @AC-USR-001
  Scenario: Acceso sin permiso no persiste cambios
    Given que existe un usuario sin el permiso "usuarios.editar"
    When intenta editar el perfil de otro usuario
    Then la solicitud es rechazada con 403
    And el perfil del otro usuario no cambia

  @AC-USR-002
  Scenario: Búsqueda y paginación del listado de usuarios
    Given que existen más usuarios que el tamaño de una página
    When el administrador busca por un fragmento de nombre de usuario
    Then el listado devuelto solo contiene coincidencias
    And la paginación indica el total de resultados

  @AC-USR-010
  Scenario: El nombre de usuario se compone del nombre de la persona
    When se da de alta a "Diego Peñarreta"
    Then su nombre de usuario es "dpenarreta"
    # Escrito a mano conviven «dpenarreta», «d.penarreta», «diegop» y
    # «DPenarreta»: cuatro formas de nombrar a la misma persona, ninguna
    # deducible desde la otra.

  @AC-USR-011
  Scenario: Sin tildes ni eñes
    When el apellido lleva tildes, eñes o diéresis
    Then el nombre de usuario las pierde
    # Es lo que se teclea en la casilla de inicio de sesión.

  @AC-USR-012
  Scenario: El segundo con el mismo nombre lleva número
    Given una cuenta llamada "dperez"
    When se da de alta a otra persona cuyo nombre daría "dperez"
    Then su nombre de usuario es "dperez2"

  @AC-USR-013
  Scenario: El nombre de usuario no se escribe
    When se abre el formulario de alta
    Then el nombre de usuario aparece calculado y no se puede teclear
    And la API rechaza un nombre de usuario enviado a mano
    # Si la API lo aceptara, la convención valdría solo mientras nadie la usara.
