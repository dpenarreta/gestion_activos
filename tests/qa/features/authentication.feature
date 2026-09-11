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

  # --- El cliente HTTP del navegador ---------------------------------------

  @AC-CLI-001
  Scenario: Cada petición dice quién pregunta y desde qué empresa
    Given una sesión abierta y una empresa elegida
    When el navegador consulta cualquier recurso
    Then la petición lleva la sesión y la empresa
    But sin empresa elegida no manda la cabecera vacía
    # El backend resuelve la predeterminada; una cabecera vacía haría que
    # pidiera una empresa con id «».

  @AC-CLI-002
  Scenario: Un token vencido se renueva y la petición se reintenta
    Given una petición que responde 401 por token vencido
    When el cliente renueva la sesión
    Then reintenta la misma petición con el token nuevo
    And el usuario no se entera

  @AC-CLI-003
  Scenario: La renovación se intenta una sola vez
    When el reintento vuelve a responder 401
    Then se cierra la sesión y se va al login
    And no se dispara otra renovación
    # Sin el tope, cada 401 dispara otro refresco: un bucle que cuelga la
    # pantalla en vez de decir que la sesión terminó.

  @AC-CLI-004
  Scenario: Varias peticiones que vencen a la vez comparten una renovación
    Given una pantalla que pide cuatro recursos y todos responden 401
    When el cliente los atiende
    Then se renueva la sesión una sola vez
    # El backend revoca la sesión al detectar la reutilización de un refresh ya
    # rotado: cuatro renovaciones simultáneas dejarían al usuario fuera por
    # haber abierto una pantalla completa.

  @AC-CLI-005
  Scenario: Un login rechazado no dispara una renovación
    When las credenciales son incorrectas
    Then el error se muestra tal cual
    And no se intenta renovar ni se redirige
    # Es el bucle clásico: el 401 del login pide un refresco, que falla, que
    # redirige al login donde el usuario ya estaba.

  @AC-CLI-006
  Scenario: Un fallo de red no cierra la sesión
    When la petición no llega a responder
    Then el error se propaga y la sesión queda intacta

  @AC-CLI-007
  Scenario: El cambio de contraseña obligatorio lleva a su pantalla
    Given un administrador que lo activó desde otra sesión
    When la pestaña ya abierta hace cualquier petición
    Then va a la pantalla de cambio, no al login

  @AC-CLI-008
  Scenario: Sin almacenamiento la aplicación sigue abriendo
    Given un navegador que bloquea el almacenamiento del sitio
    When se consulta o se cambia la empresa activa
    Then no revienta y se trabaja en la predeterminada

  @AC-E2E-009
  Scenario: Entrar lleva a trabajar, no a una portada
    Given una cuenta con acceso al panel
    When inicia sesión
    Then llega a la primera pantalla que puede abrir
    # Antes se aterrizaba en una portada con un saludo y un botón para seguir
    # hasta el panel: un clic de más cada día por una pantalla que no respondía
    # ninguna pregunta. Vale para todas las puertas —el login, una dirección
    # guardada, el logo del menú—, no solo para el formulario.
