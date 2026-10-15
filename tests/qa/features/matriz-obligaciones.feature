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
