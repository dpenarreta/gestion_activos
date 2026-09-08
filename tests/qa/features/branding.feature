Feature: Identidad institucional y tema visual (Configuración)
  Como administrador del sistema
  Quiero personalizar el nombre, logo, colores y tipografía del portal
  Para que el sistema tenga su propia identidad visual sin tocar código

  # La identidad es editable por completo desde el panel administrativo, no
  # solo estática. Ver docs/architecture.md, sección "Decisiones de alcance".

  Background:
    Given que existe un administrador con los permisos "configuracion.ver" y "configuracion.editar"

  @AC-BR-001
  Scenario: Cambiar el nombre del sitio
    When el administrador actualiza el nombre del sitio
    Then el cambio se guarda y queda disponible de inmediato en el tema público
    And se registra un evento de auditoría "theme.updated"

  @AC-BR-002
  Scenario: Ingresar un color hexadecimal válido
    When el administrador ingresa un color primario en formato hexadecimal válido
    Then el valor se guarda sin advertencias de formato

  @AC-BR-003
  Scenario: Ingresar un color hexadecimal inválido
    When el administrador ingresa un valor que no es un color hexadecimal válido
    Then el sistema rechaza el guardado
    And el tema conserva su valor anterior

  @AC-BR-004
  Scenario: Advertencia de contraste insuficiente sin bloquear el guardado
    When el administrador configura un color de texto igual al color de fondo
    Then el sistema guarda el cambio de todas formas
    But advierte que esa combinación no cumple el contraste mínimo AA (4.5:1)

  @AC-BR-005
  Scenario: Catálogo de tipografías y radios de borde disponible para el selector
    When el frontend solicita las opciones de tema
    Then recibe el catálogo cerrado de fuentes y de radios de borde permitidos

  @AC-BR-006
  Scenario: Restaurar los valores por defecto del tema
    Given que el tema fue personalizado
    When el administrador restaura los valores por defecto
    Then el tema vuelve exactamente a la identidad institucional base
    And se registra un evento de auditoría "theme.reset"

  @AC-BR-007
  Scenario: El tema vigente se puede leer sin autenticación
    When se consulta el tema actual sin iniciar sesión
    Then el sistema responde con los datos públicos del tema
    # Necesario para que el login y el registro se pinten con la marca
    # configurada antes de que exista una sesión.

  @AC-BR-008
  Scenario: Editar la configuración sin el permiso correspondiente
    Given que existe un usuario sin el permiso "configuracion.editar"
    When intenta modificar el tema
    Then el backend rechaza la solicitud con 403

  @AC-BR-009
  Scenario: El logo y el favicon se administran como URL de texto, sin biblioteca de medios
    When el administrador ingresa la URL de un logo y de un favicon
    Then ambos se guardan como texto plano en la configuración
    And el sistema no depende de ningún servicio de carga de archivos para mostrarlos

  @AC-BR-010
  Scenario: La apariencia claro/oscuro es una preferencia local, independiente del tema del sitio
    When el administrador cambia la apariencia del panel a "Oscuro"
    Then el cambio se aplica de inmediato en ese dispositivo
    And no requiere guardar ni afecta el tema público del sitio
