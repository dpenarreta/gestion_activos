Feature: Seguridad de JWT
  Como responsable de seguridad del sistema
  Quiero que los tokens JWT se emitan, expiren y se revoquen de forma segura
  Para que una sesión comprometida o vencida nunca otorgue acceso indebido

  @AC-019
  Scenario: El token se firma con un secreto configurado por variable de entorno
    Given que la aplicación arrancó con JWT_SECRET_KEY definido en el entorno
    When se emite un access token
    Then el token está firmado con ese secreto y ningún secreto queda escrito en el código fuente

  @AC-020
  Scenario: El access token tiene una expiración configurable
    Given que JWT_ACCESS_TOKEN_LIFETIME_MINUTES está configurado
    When se emite un access token
    Then el token expira transcurrido ese tiempo

  @AC-020
  Scenario: Un access token expirado es rechazado
    Given que el usuario tiene un access token ya expirado
    When intenta acceder a una ruta protegida
    Then el sistema responde 401
    And la respuesta nunca incluye la contraseña ni información sensible

  @AC-020
  Scenario: Renovación de tokens con un refresh token vigente
    Given que el usuario inició sesión y conserva su refresh token
    When solicita renovar sus tokens
    Then recibe un nuevo access token válido
    And la sesión original permanece activa

  @AC-JWT-001
  Scenario: Reutilización de un refresh token ya rotado revoca la sesión
    Given que el usuario ya renovó sus tokens una vez
    When intenta reutilizar el refresh token anterior, ya invalidado
    Then el sistema rechaza la solicitud
    And revoca la sesión completa como medida de contención

  @AC-022
  Scenario: Una ruta administrativa exige autenticación
    When se solicita un listado administrativo sin token de acceso
    Then el sistema responde 401

  @AC-023
  Scenario: El registro de auditoría nunca contiene tokens completos
    Given que ocurrió un evento de auditoría relacionado con sesiones o tokens
    When se consulta el detalle del evento
    Then cualquier campo cuyo nombre sugiera un token o secreto aparece enmascarado

  @AC-JWT-002
  Scenario: La sesión se cierra tras cuatro horas sin usarla
    Given una sesión iniciada que lleva cuatro horas sin ninguna petición
    When su dueño vuelve a usar el sistema
    Then la sesión ya no vale y se le pide iniciar sesión otra vez
    And la pantalla de login dice que se cerró por inactividad
    # Sin el motivo se lee como un fallo del sistema, y lleva a reintentar
    # pensando que algo va mal.

  @AC-JWT-003
  Scenario: Volver antes del plazo lo reinicia
    Given una sesión que lleva tres horas y media sin usarse
    When su dueño hace cualquier petición
    Then la sesión sigue viva
    And a partir de esa petición vuelven a contarse cuatro horas desde cero
    # El plazo mide inactividad, no duración: quien trabaja todo el día no
    # tiene por qué volver a entrar a media tarde.

  @AC-JWT-004
  Scenario: Renovar el token no cuenta como actividad
    Given una sesión sin usar desde hace rato
    When el navegador renueva su token de acceso
    Then la cuenta de inactividad sigue donde estaba
    # Renovar lo hace el navegador, no la persona. Si contara, una pestaña
    # olvidada abierta mantendría la sesión viva sin nadie delante.

  @AC-JWT-005
  Scenario: La sesión vencida se cierra, no solo se rechaza
    Given una sesión que pasó el plazo de inactividad
    When se intenta usarla o renovarla
    Then queda revocada y su token de renovación deja de valer
    # Si solo se rechazara la petición, el refresh token seguiría sirviendo y
    # la siguiente la reviviría.
