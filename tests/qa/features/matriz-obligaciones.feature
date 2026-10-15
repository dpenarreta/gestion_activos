Feature: Matriz de obligaciones — fase 1: base y acceso
  Como persona que responde por las obligaciones de una o varias empresas
  Quiero entrar a la Matriz solo donde tengo un rol, y saber cuál
  Para que nadie vea ni cierre obligaciones de una empresa que no es la suya

  # Especificación: matriz_admin/docs/modulo/MODULO-MATRIZ-OBLIGACIONES.md.
  # La fase 1 sale cuando «un usuario solo ve sus empresas, con su rol» (§21).

  @AC-MTZ-001
  Scenario: Un rol global no da permisos de la Matriz
    Given una persona con un rol global que incluye «matriz.validar»
    And sin rol de la Matriz en la membresía de una empresa
    When trabaja en esa empresa
    Then no puede validar cierres ahí
    And los demás permisos globales le siguen valiendo
    # §8.1: los permisos de la Matriz salen solo del rol de la membresía. Es
    # la diferencia con el resto del sistema, donde un rol global vale en
    # todas las empresas.

  @AC-MTZ-002
  Scenario: El rol de la membresía vale solo en su empresa
    Given una persona supervisora de la Matriz en LaarCourier y sin rol en LaarSeguridad
    Then valida en LaarCourier y en LaarSeguridad no tiene ningún permiso de la Matriz
    But el superusuario tiene toda la Matriz en todas las empresas

  @AC-MTZ-003
  Scenario: Solo ve sus empresas, con su rol
    When una persona consulta en qué empresas puede entrar a la Matriz
    Then se listan solo las empresas donde tiene un rol de la Matriz, con ese rol
    And una empresa inactiva no da acceso a nadie
    And el selector de empresa de la barra superior dice el rol en cada una

  @AC-MTZ-004
  Scenario: La entrada de la Matriz dice dónde se está y con qué rol
    When se abre la Matriz
    Then muestra la empresa activa, su zona horaria, el rol y qué permite
    And sin rol de la Matriz en la empresa activa, lo dice y cómo resolverlo

  @AC-MTZ-005
  Scenario: Los roles de la Matriz vienen sembrados y son editables
    Then existen «Matriz · Administrador», «Matriz · Responsable», «Matriz · Supervisor/Aprobador» y «Matriz · Auditor»
    And cada uno con los permisos de la tabla de la sección 7
    And el rol «Superusuario» recibe los permisos nuevos
    # Llevan el prefijo porque ya existe un «Administrador» del inventario.

  @AC-MTZ-006
  Scenario: Áreas y entidades de control compartidas
    Then vienen sembradas las 8 áreas y las 8 entidades de control de la sección 5
    And se consultan con «catalogos.ver» y se editan con «catalogos.editar»
    And cada cambio queda auditado
    And viven en Configuración → Catálogos, junto a los del inventario

  @AC-MTZ-007
  Scenario: La empresa tiene lo que la Matriz necesita
    Then cada empresa tiene zona horaria, color, gerente general y qué fecha cuenta como cumplimiento
    And una zona horaria o un color mal escritos se rechazan
    And el gerente general debe trabajar en la empresa

  @AC-MTZ-008
  Scenario: El selector de módulos ofrece los módulos con algo que abrir
    When se abre el selector de módulos de la barra superior
    Then ofrece Gestión de Activos y Matriz de obligaciones, si tiene acceso a ambos
    And con un solo módulo no se dibuja
    And elegir otro lleva a su inicio

  @AC-MTZ-009
  Scenario: Cada módulo trae su menú; Configuración es común
    When se trabaja en un módulo
    Then el menú lateral muestra solo sus pantallas, más Configuración

  @AC-MTZ-010
  Scenario: Configuración conserva el módulo desde el que se llegó
    Given se está en la Matriz
    When se abre una pantalla de Configuración
    Then el menú lateral sigue siendo el de la Matriz

  # --- Fase 2: obligaciones, períodos y la matriz ---------------------------

  @AC-MTZ-011
  Scenario: El estado se calcula, no se guarda
    Then un período cerrado a tiempo es «Finalizado» y cerrado tarde «Finalizada fuera de plazo», con sus días de atraso
    And uno abierto pasa a «Incumplido» justo después de su hora de vencimiento
    And el día del vencimiento muestra «Vence hoy» sin perder su etapa
    # §9: un período pendiente de validación sigue pendiente el día que vence
    # (el defecto del prototipo original).

  @AC-MTZ-012
  Scenario: Los días se cuentan en la zona horaria de la empresa
    Given una empresa en una zona horaria distinta a la del servidor
    Then «vence hoy» y los días restantes se calculan en la hora de esa empresa

  @AC-MTZ-013
  Scenario: El alta crea la obligación y su primer período
    When se crea una obligación
    Then nace con su primer período, inicio 30 días antes, preparación 5 días antes, a las 17:00 de la empresa
    And el aprobador por defecto es el gerente general
    And el historial dice «Obligación creada» y queda en la auditoría

  @AC-MTZ-014
  Scenario: Los códigos son correlativos
    Then cada período recibe el siguiente código OBL-0001, OBL-0002…, sin repetir aunque se creen a la vez

  @AC-MTZ-015
  Scenario: El nombre de una obligación no se repite en la empresa
    When se crea otra con el mismo nombre, aunque cambien las mayúsculas
    Then se rechaza con «Ya existe una obligación con ese nombre en la empresa.»

  @AC-MTZ-016
  Scenario: Los responsables trabajan en la empresa
    When se elige como responsable a alguien de otra empresa
    Then se rechaza

  @AC-MTZ-017
  Scenario: Crear exige su permiso
    Given alguien sin «matriz.crear»
    Then no ve «Nueva obligación», y si lo intenta por la API recibe 403 y queda en la auditoría

  @AC-MTZ-018
  Scenario: Quien no ve toda la empresa crea solo en sus áreas
    Given un responsable sin «ver_todas» con áreas asignadas en su membresía
    Then solo crea obligaciones de esas áreas

  @AC-MTZ-019
  Scenario: Sin «ver_todas», solo lo propio
    Then la matriz, el tablero y el detalle se limitan a los períodos donde es responsable o suplente
    And pedir uno ajeno responde 404

  @AC-MTZ-020
  Scenario: Sin rol de la Matriz, nada existe
    Then todo responde 404 a quien no tiene un rol de la Matriz en la empresa activa, y desde otra empresa el período no existe

  @AC-MTZ-021
  Scenario: Los botones del detalle los decide el servidor
    Then el detalle trae las acciones permitidas y la pantalla dibuja solo esas

  @AC-MTZ-022
  Scenario: Editar el seguimiento deja historial campo por campo
    When se cambian el responsable y el avance
    Then el historial tiene una línea por campo con el valor anterior y el nuevo
    And un período cerrado no se edita y el responsable no se puede quitar

  @AC-MTZ-023
  Scenario: La matriz ordena por urgencia, filtra, busca y agrupa
    Then por defecto van primero los incumplidos, luego en progreso, luego finalizados
    And se filtra por estado, área, entidad, responsable y prioridad, se busca, se ordena por columna y se agrupa por área o entidad
    And la columna «Días» dice el atraso, si vence hoy o cuánto falta
    And una fila abre el detalle en un panel lateral

  @AC-MTZ-024
  Scenario: El tablero dice lo que pide atención
    Then muestra Incumplidas, En progreso, Próximas a vencer y Finalizadas (a tiempo y fuera de plazo)
    And los próximos vencimientos y los cierres recientes
    And el menú lleva el contador de lo incumplido o que vence hoy

  @AC-MTZ-025
  Scenario: Las fechas de los períodos
    Then la etiqueta sale del mes del vencimiento: «Octubre 2026», «T4 2026», «S2 2026», «Período 2026», «Período único»
    And sin fecha, el primer vencimiento sale de la regla de la plantilla
    And el siguiente respeta el fin de mes (31 → 30 o 28)

  # Fase 3: evidencias y cierre

  @AC-MTZ-026
  Scenario: Solo se aceptan PDF, con tope de tamaño
    When se carga un archivo que no es PDF, que no empieza por «%PDF-» o que supera el tope (10 MB)
    Then el servidor lo rechaza con un mensaje claro
    And la pantalla lo avisa antes de subirlo por extensión y tamaño

  @AC-MTZ-027
  Scenario: Cargar evidencia versiona y pone en marcha el período
    When se carga un PDF con el mismo nombre que otro del período
    Then queda como una versión nueva y la anterior se conserva
    And la primera evidencia pasa el período de «Sin iniciar» a «En preparación»
    And cada archivo de una carga múltiple tiene su progreso y su error

  @AC-MTZ-028
  Scenario: El archivo se sirve con la sesión y cada acceso queda auditado
    Then el PDF se ve en el visor del navegador y se descarga por su endpoint, nunca por una ruta pública
    And el archivo de un período ajeno responde 404

  @AC-MTZ-029
  Scenario: Rechazar una evidencia exige motivo; eliminar es lógico
    When quien valida rechaza un documento con un motivo de al menos 10 caracteres
    Then el documento queda en rojo con su motivo y deja de contar como evidencia
    And eliminar un rechazado lo oculta sin borrar el archivo

  @AC-MTZ-030
  Scenario: Sin evidencia válida no se envía
    Then «Enviar a validación» responde con un error si el período no tiene un documento válido

  @AC-MTZ-031
  Scenario: Enviar y validar cierran el período
    When el responsable envía y otra persona valida
    Then el período queda «Finalizado» con la fecha de cumplimiento
    And las dos acciones piden confirmación en la pantalla

  @AC-MTZ-032
  Scenario: Separación de funciones
    Then quien envió o cargó la evidencia no puede validar el mismo período

  @AC-MTZ-033
  Scenario: El cumplimiento sigue la base de la empresa
    Then si la empresa cuenta la validación, un cierre posterior al vencimiento queda «Finalizada fuera de plazo»
    And si cuenta el envío, la fecha de cumplimiento es la del envío

  @AC-MTZ-034
  Scenario: Devolver exige motivo
    When quien valida devuelve el período con un motivo de al menos 10 caracteres
    Then vuelve a «En preparación» y el motivo queda en el historial

  @AC-MTZ-035
  Scenario: Cambiar la fecha exige permiso y justificación
    Then solo Administrador y Supervisor cambian el vencimiento, con justificación
    And el cambio queda en el historial con la fecha anterior
    And un período cerrado no cambia de fecha

  @AC-MTZ-036
  Scenario: La vista Documentos
    Then separa los períodos con evidencia válida de los pendientes
    And cada fila abre el período en el panel lateral

  # Fase 4: recordatorios

  @AC-MTZ-037
  Scenario: Los recordatorios llegan en cada anticipación, una sola vez
    Then con la configuración por defecto llegan 15, 7, 3 y 1 día antes y el día del vencimiento
    And van al responsable y, si la empresa lo pide, al suplente, sin repetir correos y omitiendo a quien no tiene
    And el del día del vencimiento tiene el asunto «Hoy vence — {Obligación} ({Período})»

  @AC-MTZ-038
  Scenario: A la hora de envío de la empresa, en su zona horaria
    Then ningún aviso sale antes de la hora configurada en la hora local de la empresa

  @AC-MTZ-039
  Scenario: Correr el programador dos veces no duplica nada
    Then cada aviso tiene una clave única y una segunda pasada no envía otra vez
    And si cambia la fecha de vencimiento, los avisos se reprograman

  @AC-MTZ-040
  Scenario: Al validar, dejan de enviarse
    Then un período cerrado no recibe recordatorios ni escalamientos
    And su pestaña Recordatorios dice que están suspendidos

  @AC-MTZ-041
  Scenario: El escalamiento llega al supervisor o al aprobador
    Then con 2 días de atraso se avisa al supervisor, o al aprobador si no hay
    And se envía una sola vez, o cada N días si la empresa lo configura
    And queda en el historial «Escalamiento enviado a {nombre}» con los días de atraso, por «Sistema»

  @AC-MTZ-042
  Scenario: Un envío fallido se reintenta sin duplicar
    Then el fallo queda con su error y se reintenta solo hasta 3 intentos
    And cada reintento es una notificación nueva y la original queda «Reintentada»
    And «Reintentar» a mano lo hace quien tiene «recordar»

  @AC-MTZ-043
  Scenario: La configuración de recordatorios por empresa
    Then la ve cualquiera con un rol de la Matriz y la cambia quien tiene «configurar»
    And las anticipaciones van de 0 a 90 sin repetir, y el día del vencimiento siempre está

  @AC-MTZ-044
  Scenario: Vista previa del correo
    Then muestra para, asunto y cuerpo del aviso elegido sin enviar nada
    And el enlace lleva al período en la empresa del aviso

  @AC-MTZ-045
  Scenario: Reenviar un recordatorio
    Then siempre sale, queda en el historial y en la auditoría, y exige «recordar»

  @AC-MTZ-046
  Scenario: La programación y el historial de avisos
    Then el período muestra por cada anticipación su fecha y si quedó programado, enviado, fallido, no enviado o suspendido
    And la empresa ve sus notificaciones filtradas por estado con «ver_auditoria»

  # Fase 5: reportes y configuración

  @AC-MTZ-047
  Scenario: Los períodos siguientes se generan solos
    Then para cada obligación recurrente activa, cuando su último período vence dentro de 30 días, se crea el siguiente
    And hereda responsable, suplente, supervisor, aprobador, prioridad y sucursal, con «Registro del período generado» por «Sistema»
    And suma 1, 3, 6 o 12 meses según la periodicidad; la única y la inactiva no generan

  @AC-MTZ-048
  Scenario: Generar es idempotente y tiene tope
    Then correr el ciclo dos veces no crea dos veces el mismo período
    And nunca crea más de 24 por obligación en una pasada

  @AC-MTZ-049
  Scenario: El calendario del mes
    Then muestra los vencimientos del mes, de domingo a sábado, con hoy resaltado y el color del estado
    And hasta tres por día con «+N más», y un clic abre el detalle
    And sin «ver_todas», solo lo propio

  @AC-MTZ-050
  Scenario: El reporte de cumplimiento
    Then cumplimiento a tiempo = cerrados a tiempo ÷ cerrados × 100, redondeado, y 0 sin cerrados; tardío igual con los fuera de plazo
    And barras por área y por entidad con finalizados, en progreso, incumplidos y total, ordenadas por nombre
    And respeta el rango de fechas de vencimiento y el alcance propio

  @AC-MTZ-051
  Scenario: Exportar a Excel y PDF
    Then la matriz y el reporte se exportan con las mismas filas y filtros que la pantalla
    And el archivo dice la empresa, la fecha de corte y quién exportó
    And exige «exportar» y cada exportación queda en la auditoría como «report.exported»

  @AC-MTZ-052
  Scenario: La auditoría de la empresa
    Then quien tiene «ver_auditoria» ve el historial de los períodos de la empresa, del más reciente al más antiguo
    And filtra por persona (o «Sistema»), acción y fechas, y no ve nada de otra empresa

  @AC-MTZ-053
  Scenario: Las áreas de la Matriz en la ficha del usuario
    Then en la asignación de empresas se marcan las áreas en que crea obligaciones quien no ve toda la empresa
    And guardar la ficha sin enviarlas conserva las que tenía

  @AC-MTZ-054
  Scenario: Una empresa no se queda sin quien gestione sus miembros
    Then quitar el último rol con «gestionar_miembros» de una empresa se rechaza y no cambia nada
    And una empresa que nunca tuvo ese rol no bloquea ninguna ficha

  @AC-MTZ-055
  Scenario: La acción «Reenviar recordatorio» sigue a la especificación
    Then el detalle ofrece «remind» solo en un período abierto, con recordatorios no suspendidos y a quien tiene «recordar»

  @AC-MTZ-056
  Scenario: El menú y Configuración del módulo
    Then el menú de la Matriz tiene Resumen, Matriz, Calendario, Documentos y Reportes
    And Configuración → Auditoría tiene «Sistema» con «auditoria.ver» y «Matriz» con «ver_auditoria»
