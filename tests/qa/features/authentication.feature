Feature: Autenticación de usuarios
  Como usuario registrado
  Quiero autenticarme en la plataforma
  Para acceder únicamente a las funciones autorizadas

  Background:
    Given que existe un usuario activo "ada" con contraseña válida

  @AC-016
  Scenario: Inicio de sesión exitoso
    When el usuario envía sus credenciales correctas al sistema
    Then el backend valida la contraseña mediante el mecanismo de hash de Django
    And genera un access token y un refresh token válidos
    And se registra una nueva sesión activa

  @AC-016
  Scenario: Rechazo de credenciales inválidas
    When el usuario ingresa una contraseña incorrecta
    Then el sistema rechaza la autenticación con un mensaje genérico
    And no genera tokens
    And registra el intento fallido

  @AC-016
  Scenario: Un identificador inexistente recibe la misma respuesta que una contraseña incorrecta
    When el usuario ingresa un identificador que no corresponde a ninguna cuenta
    Then la respuesta es idéntica en código y mensaje a la de una contraseña incorrecta
    And el sistema no revela si la cuenta existe

  @AC-016
  Scenario: Un usuario deshabilitado no puede iniciar sesión
    Given que el usuario "ada" está deshabilitado
    When el usuario intenta iniciar sesión con sus credenciales correctas
    Then el sistema rechaza la autenticación con el mensaje genérico
    And no se emiten tokens

  @AC-016
  Scenario: Deshabilitar un usuario revoca sus sesiones activas de inmediato
    Given que "ada" tiene una sesión activa
    When un administrador deshabilita al usuario "ada"
    Then todas las sesiones activas de "ada" quedan revocadas

  @AC-021
  Scenario: Consulta del usuario autenticado
    Given que el usuario inició sesión correctamente
    When consulta su perfil autenticado
    Then recibe sus datos públicos y la lista de permisos vigentes
    But nunca recibe su contraseña ni el hash almacenado

  @AC-021
  Scenario: Un usuario no autenticado no puede consultar su perfil
    When se solicita el perfil sin un token de acceso
    Then el sistema responde con 401 (no autenticado)

  @AC-AUTH-001
  Scenario: Registro público de un nuevo usuario
    When una persona se registra con datos válidos
    Then se crea la cuenta con la contraseña correctamente hasheada
    And se emiten tokens de acceso inmediatamente

  @AC-AUTH-002
  Scenario: Cierre de sesión individual
    Given que el usuario tiene una sesión activa con un access token vigente
    When cierra sesión
    Then esa sesión queda revocada
    And el token ya no permite acceder a rutas protegidas

  @AC-AUTH-003
  Scenario: Protección contra fuerza bruta
    Given que se registraron demasiados intentos fallidos para el mismo identificador
    When se reintenta iniciar sesión, incluso con la contraseña correcta
    Then el sistema rechaza el intento por bloqueo temporal
