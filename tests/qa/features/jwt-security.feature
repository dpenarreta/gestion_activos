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
