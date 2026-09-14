Feature: Puesta en marcha (§13 y §21 del documento funcional)
  Como responsable del sistema
  Quiero poner el sistema en producción sin dejarme nada
  Para que no falle en silencio delante de quien confía en él

  @AC-PUE-001
  Scenario: El sistema trae los cuatro roles del documento
    When se ejecuta la creación de roles iniciales
    Then existen Administrador, Soporte TI, Supervisor TI y Consulta / Auditoría

  @AC-PUE-002
  Scenario: Soporte no puede dar de baja un activo
    When se revisan los permisos del rol Soporte TI
    Then puede registrar y asignar, pero no dar de baja
    # El §13 pone la aprobación de bajas en el supervisor: quien opera el
    # inventario a diario no debería sacar un equipo del parque sin que nadie
    # más lo mire.

  @AC-PUE-003
  Scenario: Soporte no puede borrar evidencia
    When se revisan los permisos del rol Soporte TI
    Then puede subir adjuntos pero no eliminarlos

  @AC-PUE-004
  Scenario: El supervisor aprueba pero no opera
    When se revisan los permisos del rol Supervisor TI
    Then aprueba bajas y define reglas, pero no crea ni edita fichas
    # Si quien decide la baja es también quien mantiene la ficha, la
    # aprobación no controla nada.

  @AC-PUE-005
  Scenario: El rol de consulta no modifica nada
    When se revisan los permisos del rol Consulta / Auditoría
    Then solo tiene permisos de lectura y exportación

  @AC-PUE-006
  Scenario: Los roles son una plantilla, no una imposición
    Given roles ya ajustados desde el panel
    When se vuelve a ejecutar la creación de roles
    Then los ajustes se conservan
    # Los roles son una decisión de cada empresa; reescribir lo que alguien
    # ajustó sería peor que no correr.

  @AC-PUE-007
  Scenario: La revisión previa detecta DEBUG encendido
    Given el sistema configurado con DEBUG activo
    When se ejecuta la verificación de despliegue
    Then se reporta como crítico y el comando falla
    # Cualquier error mostraría la traza completa, con rutas y fragmentos de
    # configuración, a quien lo provoque.

  @AC-PUE-008
  Scenario: La revisión avisa de que el correo no sale de verdad
    Given el backend de correo de consola
    When se ejecuta la verificación de despliegue
    Then se advierte que el envío se da por exitoso sin que nadie lo reciba

  @AC-PUE-009
  Scenario: La revisión detecta tareas programadas que no corren
    Given que hace días que no se recalculan los indicadores
    When se ejecuta la verificación de despliegue
    Then se advierte que la sugerencia de renovación por longevidad no se encenderá
    # Ese criterio se cumple por el paso del tiempo: sin la tarea, un equipo
    # que nadie toca nunca dispara la alerta.

  @AC-PUE-010
  Scenario: La revisión recuerda el inventario inicial
    Given un sistema sin activos cargados
    When se ejecuta la verificación de despliegue
    Then se advierte que falta el levantamiento del inventario
    # Es el riesgo número uno del §26 del propio documento.

  @AC-PUE-020
  Scenario: El verificador dice qué configuración está midiendo
    Given el verificador ejecutado fuera de producción
    When se leen sus resultados
    Then avisa de que revisa esa configuración y no la de producción
    And dice con qué invocación se revisa la de verdad
    # Con la de desarrollo siempre salen dos críticos —`DEBUG` y las cuentas de
    # demostración— y tienen que salir: si esa configuración se desplegara,
    # serían críticos de verdad. Lo que no puede pasar es que alguien aprenda a
    # ignorarlos, porque entonces tampoco los mira el día que cuentan.

  @AC-PUE-021
  Scenario: La configuración de producción no se puede aflojar sin que salte
    When se revisa el módulo de configuración de producción
    Then DEBUG está apagado, escrito en el archivo y no leído del entorno
    And las cookies solo viajan por HTTPS
    And HSTS dura al menos un año, con subdominios y precarga
    # El verificador es la puerta, pero corre el día del despliegue. Esto cubre
    # la mitad que vive en el repositorio, que es la que se rompe en una
    # revisión de código un viernes.
