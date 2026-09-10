# Códigos de barras y lectura con pistola (RF-02, RF-03, RF-08, §5)

El sistema identifica cada equipo con un **código de barras 1D Code 128**, no
con QR. La decisión es deliberada: el QR necesita una cámara y un enfoque, y el
inventario se hace con una pistola láser en la mano recorriendo estantes. Code
128 lo lee cualquier lector del mercado —Zebra, Honeywell, Datalogic o una
pistola genérica de sesenta dólares— sin configuración especial.

## El código

Formato: `GA-<TIPO>-<SECUENCIA>`, por ejemplo `GA-LAP-000001`. Trece
caracteres. El prefijo de empresa se cambia en `apps/activos/barcode.py`, pero
**renumeraría solo los activos nuevos**: los ya etiquetados conservan el suyo,
porque la etiqueta está pegada a un equipo físico.

Trece caracteres es el límite práctico de la etiqueta de 50 × 25 mm (ver abajo).
Con un prefijo más largo o una secuencia de siete dígitos habría que ampliar la
etiqueta; hay una prueba que lo detecta antes que el operario con el lector.

## Qué decide que una pistola lo lea

No es el formato del archivo, son tres medidas físicas del símbolo impreso. Las
tres se comprueban en `apps/activos/tests/test_legibilidad_etiquetas.py` y se
pueden consultar por API: `GET /activos/{id}/etiqueta/medicion/`.

| Medida | Valor actual | Por qué |
| --- | --- | --- |
| **Ancho de la barra más fina** (módulo) | 0,25 mm | Dos puntos de una impresora de 203 dpi. Por debajo, una pistola de gama común empieza a fallar sobre plástico curvo |
| **Zona muda** a cada lado | 2,5 mm (10 módulos) | Lo que exige la norma. Sin blanco antes de la primera barra, el lector no encuentra dónde empieza el símbolo |
| **Altura de barras** | 9 mm | Por debajo de 8 mm hay que apuntar con una precisión que nadie tiene con el equipo en la mano |

El ancho de módulo es **múltiplo exacto del punto de impresora**. Si no lo
fuera, la térmica redondearía cada barra por su cuenta y la proporción entre
barras anchas y estrechas —que es justo lo que el lector decodifica— saldría
distorsionada de forma irregular a lo largo del símbolo.

Debajo de las barras va el código en texto: si la etiqueta se raya o el lector
falla, se puede teclear o dictar.

> **Nada de esto sustituye a escanear una etiqueta impresa de verdad.** La
> legibilidad final depende también del material, del contraste y de la
> calibración de la impresora. Lo que garantizan las medidas es que el símbolo
> no sea el problema.

## Los tres formatos de salida

| Formato | Para qué | Endpoint |
| --- | --- | --- |
| **PDF** | Imprimir en cualquier impresora, previsualizar, archivar o mandar por correo. Página del tamaño físico de la etiqueta | `?formato=pdf` |
| **ZPL** | Zebra y compatibles. Se envía a la cola de la impresora térmica | `?formato=zpl` |
| **TSPL** | TSC, Godex y compatibles | `?formato=tspl` |

El PDF sale con la página a **tamaño físico real** (50 × 25 mm). Al imprimir hay
que elegir **«Tamaño real» o «100 %», nunca «Ajustar a la página»**: el ajuste
reescala el símbolo y todas las medidas de arriba dejan de valer. Es la causa
más frecuente de que una etiqueta salga ilegible con el archivo correcto.

Para lotes, `POST /activos/etiquetas/` genera un solo trabajo con hasta 200
etiquetas.

El sistema **no envía nada a la impresora**: produce el archivo y el operador lo
manda a la cola. Abrir un socket 9100 contra una IP arbitraria desde el
servidor convertiría el endpoint en un pivote de red, y ese riesgo no se
justifica para ahorrar un paso manual.

## Configurar la pistola

Las pistolas USB y Bluetooth se comportan como un **teclado HID**: «teclean» el
código carácter por carácter. Por eso el campo de captura del sistema es un
input común, y funciona con cualquier lector sin instalar nada.

### La distribución de teclado: el fallo más confuso

**Síntoma:** se escanea `GA-LAP-000006` y el sistema recibe `GA'LAP'000006`.
Los guiones llegan como apóstrofes, y el equipo «no aparece».

**Causa:** la pistola no envía texto, envía *pulsaciones de teclas*, y quien las
traduce a caracteres es Windows con su propia distribución. La tecla que en un
teclado **US** produce `-` está, en el **español**, en la posición del `'`. La
pistola cree haber enviado el guion y el sistema recibe otra cosa. Ni el código
de barras ni el lector están mal: los dos funcionan.

Pasa lo mismo con otras distribuciones: en francés AZERTY esa tecla da `)`, y
en alemán QWERTZ, `ß`.

**Solución, en la pistola** (una de las dos):

- Configurarla con la distribución **Español** o **Latinoamericano**, escaneando
  el código de programación correspondiente del manual del fabricante. En las
  Zebra suele estar en la sección «Keyboard Country» / «País del teclado».
- O ponerla en **modo de emulación numérica** («Emulate Keypad» / «Send
  Characters as ALT sequences»), que envía cada carácter por su código y no
  depende de la distribución.

**Mientras tanto**, el sistema lo repara: si el código no aparece, reintenta
sustituyendo esos caracteres por el guion —solo cuando el resultado tiene la
forma exacta de un código del sistema, para no tocar números de serie donde un
apóstrofe puede ser legítimo— y **avisa en pantalla**. El aviso no sobra:
arreglarlo en silencio dejaría la pistola mal configurada, y el mismo problema
reaparecería en la carga masiva y en el buscador, donde no hay quien lo repare.

### Los dos ajustes básicos

Dos ajustes en el lector, ambos de fábrica en las Zebra:

1. **Sufijo Enter (CR)** al final de la lectura. Es lo que hace que el sistema
   busque solo, sin pulsar nada. Si la pistola está configurada con Tab, la
   lectura se queda escrita en el campo sin buscar.
2. **Code 128 habilitado.** Suele estarlo; en lectores muy restringidos por
   configuración previa conviene verificarlo con el manual del fabricante.

Sin prefijos ni sufijos adicionales: cualquier carácter extra entra dentro del
código y produce una búsqueda fallida.

El campo limpia el valor tras cada lectura. Sin eso, el segundo escaneo se
concatenaría al primero y produciría un código inexistente — y en la pantalla
del escáner el foco vuelve solo, para poder disparar la pistola sin tocar el
equipo.

## Dónde se puede escanear

- **`/admin/activos/escaner`**: pantalla dedicada. Devuelve la ficha completa
  con historial y bitácora (RF-03).
- **Buscador del inventario**: acepta el código como término de búsqueda.
- La API resuelve por código **o por número de serie** en el mismo endpoint
  (`/activos/por-codigo/{valor}/`): quien tiene el equipo delante y la etiqueta
  arrancada puede teclear la serie del fabricante.
