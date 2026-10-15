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
