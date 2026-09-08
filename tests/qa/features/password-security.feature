Feature: Seguridad de contraseñas
  Como responsable de seguridad del sistema
  Quiero que las contraseñas nunca se almacenen ni se expongan en texto plano
  Para proteger las credenciales de todos los usuarios

  @AC-017
  Scenario: La contraseña se almacena únicamente como hash Argon2
    When se crea un usuario con una contraseña
    Then el valor almacenado nunca coincide con la contraseña en texto plano
    And el hash usa el algoritmo Argon2 configurado como principal

  @AC-018
  Scenario: La API nunca devuelve la contraseña ni su hash
    Given que existe un usuario con contraseña
    When se consulta ese usuario por cualquier endpoint de la API
    Then la respuesta no incluye el campo de contraseña ni su hash

  @AC-024
  Scenario: Un fallo de validación con datos de contraseña no filtra el valor en auditoría
    When una operación que incluye una contraseña falla su validación
    Then el registro de auditoría del fallo enmascara el valor de la contraseña

  @AC-PWD-001
  Scenario: Solicitud de recuperación de contraseña para una cuenta existente
    Given que existe una cuenta activa
    When se solicita recuperar la contraseña con el identificador correcto
    Then se genera un token de un solo uso y se envía un correo con el enlace
    And la respuesta al usuario es el mismo mensaje genérico que en cualquier otro caso

  @AC-PWD-002
  Scenario: Solicitud de recuperación para una cuenta inexistente no genera rastro
    When se solicita recuperar la contraseña con un identificador que no existe
    Then no se genera ningún token ni se envía correo
    And la respuesta es idéntica a la de una solicitud real

  @AC-PWD-003
  Scenario: Confirmación exitosa de recuperación de contraseña
    Given que existe un token de recuperación válido
    When se confirma el restablecimiento con una contraseña nueva y válida
    Then la contraseña del usuario queda actualizada
    And todas sus sesiones activas quedan revocadas
    And el token queda marcado como usado

  @AC-PWD-004
  Scenario: Un token de recuperación ya usado es rechazado
    Given que un token de recuperación ya fue utilizado una vez
    When se intenta usar nuevamente para cambiar la contraseña
    Then el sistema rechaza la operación
    And la contraseña original permanece sin cambios

  @AC-PWD-005
  Scenario: Un token de recuperación expirado es rechazado
    Given que un token de recuperación ya venció
    When se intenta usar para cambiar la contraseña
    Then el sistema rechaza la operación
    And el usuario puede solicitar un enlace nuevo

  @AC-PWD-006
  Scenario: Una contraseña que no cumple la política es rechazada
    Given que existe un token de recuperación válido
    When se intenta establecer una contraseña débil
    Then el sistema rechaza la solicitud por política de contraseñas
    And el token sigue siendo válido para un nuevo intento

  @AC-PWD-007
  Scenario: Restablecimiento administrativo sin exponer la nueva contraseña
    Given que un administrador con permiso "usuarios.restablecer_password" actúa sobre un usuario
    When ejecuta el restablecimiento eligiendo enviar enlace, forzar cambio o revocar sesiones
    Then el sistema ejecuta únicamente las acciones elegidas
    And el administrador nunca define ni ve la nueva contraseña

  @AC-PWD-008
  Scenario: El restablecimiento administrativo exige al menos una acción
    Given que un administrador abre el restablecimiento de contraseña de un usuario
    When intenta ejecutar la acción sin marcar ninguna opción
    Then el sistema rechaza la solicitud

  @AC-PWD-009
  Scenario: Un cambio de contraseña obligatorio bloquea el resto de la aplicación
    Given que un administrador forzó el cambio de contraseña de un usuario
    When ese usuario intenta usar cualquier endpoint distinto al cambio de contraseña
    Then el sistema responde con el código "password_change_required"
    And una vez que cambia su contraseña, el resto de la aplicación vuelve a estar disponible
