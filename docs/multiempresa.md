# Separación por empresas

Un mismo despliegue atiende a varias empresas del grupo y ninguna ve lo de las
otras. Todo lo que se registra —inventario, catálogos, mantenimientos,
políticas, adjuntos— pertenece a una empresa, y en el menú, debajo del logo, se
elige en cuál se está trabajando.

## Por qué una columna y no una base por empresa

Son empresas del mismo grupo, con el mismo administrador de sistemas y el mismo
mantenimiento. Una base por empresa multiplicaría las migraciones, los
respaldos y las conexiones sin resolver nada que una columna bien defendida no
resuelva.

**«Bien defendida» es la parte que importa.** El filtro no se escribe en cada
consulta —hay más de veinte vistas, servicios, reportes y comandos, y basta con
que uno lo olvide para que una empresa vea los datos de otra— sino en el gestor
por defecto de cada modelo:

```python
class Sede(ModeloDeEmpresa):   # trae el campo `empresa` y el gestor que filtra
    ...
```

`Sede.objects.all()` dentro de una petición devuelve **solo** las de la empresa
activa. Para salir del ámbito hay que pedirlo por su nombre —`Sede.objects.
todas()`—, que es una línea que salta a la vista en una revisión. Quien olvida
el filtro no ve de más: ve de menos, y eso se nota enseguida.

## Cómo se resuelve la empresa de cada petición

El frontend manda `X-Empresa` en cada llamada. Cabecera y no sesión del
servidor a propósito: así dos pestañas abiertas en empresas distintas no se
pisan, que es exactamente lo que hace quien compara dos inventarios.

Del lado del servidor se resuelve **al primer uso**, no al abrir la petición.
Con autenticación por token, `request.user` sigue siendo anónimo cuando corren
los middlewares de Django y solo se convierte en alguien dentro de la vista: un
middleware que preguntara ahí colgaría el aislamiento de un usuario que todavía
no existe.

Pedir una empresa a la que no se pertenece **no muestra nada**. No es un error
del usuario sino una pestaña vieja, una URL copiada o algo peor, y devolver la
empresa predeterminada haría creer que se está viendo lo pedido.

Fuera de una petición —comandos, migraciones, cron— no hay empresa activa y los
gestores no filtran: un respaldo o un recálculo de indicadores trabajan sobre el
sistema entero, que es lo que se espera de ellos.

## Membresías

`MembresiaEmpresa` dice qué empresas puede ver cada cuenta. Es una tabla y no un
campo en el usuario porque la misma persona trabaja para varias: quien
administra el inventario del grupo entra una vez y cambia de empresa desde el
menú, sin una cuenta por cada una.

Dos reglas:

- **El superusuario las ve todas** sin membresía: es la cuenta de emergencia.
- **Mientras exista una sola empresa, todas las cuentas trabajan en ella**
  aunque nadie les haya asignado membresía. En un despliegue de una empresa no
  hay de quién aislarse, y exigir el trámite convertiría cada alta de usuario en
  dos pasos con la cuenta sin ver nada entre uno y otro. **En cuanto se crea la
  segunda, la membresía pasa a ser obligatoria** y quien no la tenga no ve nada.

## Quién administra y quién reparte

Son dos permisos del catálogo y no uno:

| Permiso | Qué habilita |
| --- | --- |
| `empresas.ver` | Ver el listado de empresas y en cuáles trabaja cada usuario |
| `empresas.editar` | Crear empresas y corregir su ficha |
| `empresas.asignar` | Cambiar en qué empresas trabaja una cuenta |

Corregir el RUC de una empresa es mantenimiento de una ficha; asignarle un
usuario es **darle acceso a todo su inventario**. Juntarlos obligaría a
conceder lo segundo para permitir lo primero, y por eso `empresas.asignar` no
está incluido en `usuarios.editar`: quien administra cuentas puede corregir un
apellido sin poder abrirle a nadie la información de otra empresa.

Las empresas se administran en **Empresas** (`/admin/empresas`) y el reparto se
hace en la ficha de cada usuario, con su propio botón de guardado. La
asignación **reemplaza la lista completa** en vez de sumar y restar: quien
revisa accesos piensa en «esta persona ve estas dos», y una operación
incremental deja el resultado dependiendo de un estado anterior que nadie
recuerda.

Dos reglas del reparto: la empresa predeterminada tiene que estar entre las
asignadas —si no, se entraría cada día en una que no se puede ver— y **nadie
puede quitarse a sí mismo todas las empresas**, porque dejaría de ver todo sin
poder devolverse el acceso.

### Los roles son por empresa

La misma persona no hace lo mismo en todas: administra el inventario de
LaarCourier y solo consulta el de LaarSeguridad. Por eso los roles cuelgan de la
**membresía** y no del usuario. Con roles en el usuario, darle acceso a una
segunda empresa le entregaría de paso todos los permisos que tenía en la
primera, que es el error que nadie detecta hasta que alguien da de baja un
equipo que no era suyo.

Los permisos efectivos de una petición son la unión de tres cosas: los
asignados directamente a la cuenta, los de sus **roles globales**
(`user.groups`, que valen en cualquier empresa) y los de los roles de la
membresía **en la empresa activa**. Los globales existen porque el
administrador del grupo tiene que poder entrar a cualquiera, incluidas las que
se creen mañana; si solo hubiera roles por empresa, quedaría fuera de la
siguiente que alguien diera de alta.

El **alta de una cuenta** ya pregunta con qué empresa y qué rol entra: una
cuenta sin ninguna de las dos no puede hacer nada, y quien entrara así vería un
sistema vacío. Se pide un solo rol —el alta responde a «esta persona entra como
qué»— y las combinaciones se arman después en la ficha, donde se ve el conjunto.
Indicar la empresa en el alta exige `empresas.asignar` además de
`usuarios.crear`: dar de alta a alguien y decidir qué información va a ver son
dos poderes distintos.

Una empresa asignada **sin ningún rol** aparece en el selector pero no abre
nada dentro. Es un estado legítimo —dar el acceso hoy y el rol mañana— y la
pantalla lo advierte antes de guardar, en vez de dejar que se descubra como un
error de permisos.

Quitarle a alguien una empresa se lleva sus roles allí: un rol huérfano
volvería a valer en cuanto alguien le devolviera el acceso, sin que nadie lo
hubiera decidido.

Una empresa **no se elimina**: es la dueña de todo lo registrado y las
relaciones son `PROTECT`, así que borrarla o falla o deja el inventario
huérfano. Se desactiva, lo que la saca del selector y deja su historial en pie.

## Lo que cambió de unicidad

Lo que era único en toda la base pasó a serlo **dentro de cada empresa**: dos
empresas del grupo pueden tener las dos un área «TI», un tipo «Laptop» y hasta
un número de serie repetido entre inventarios que nunca se cruzan.

| Modelo | Único por empresa |
| --- | --- |
| `Activo` | `codigo_barras`, `numero_serie` |
| `TipoDispositivo` | `nombre`, `codigo` |
| `Departamento` | `nombre`, `codigo` |
| `Sede` | `nombre` |
| `Proveedor` | `nombre` |
| `Empleado` | `codigo_empleado` |
| `CatalogoComponente` | `nombre`, `codigo` |
| `ColumnaPlantillaActivos` | `clave` |
| `PoliticaObsolescencia` | una sola política global |

El **correlativo del código de barras** también es por empresa: el primer equipo
de la segunda empresa es `GA-LAP-000001` y no el número que dejó la primera.

## Dos trampas que costó encontrar

**Los `queryset` en el cuerpo de una clase se construyen al importar el módulo**,
cuando todavía no hay petición ni empresa activa, y se quedan con ese filtro
—o sin ninguno— para siempre. Afectaba a los desplegables de los formularios
(`PrimaryKeyRelatedField(queryset=Sede.objects.filter(...))`) y al listado de
políticas. Los primeros usan ahora `RelacionDeEmpresa`, que pide la consulta en
cada uso; el segundo pasó a `get_queryset()`.

**La caché no sabe de empresas.** El panel y el centro de alertas se cachean
unos minutos, y con una clave global el resumen que calculó una empresa se le
habría servido a la siguiente que preguntara. Las claves llevan ahora la empresa
delante.

## Qué falta por decidir

- **Las cuentas son globales**: el usuario existe una vez para todo el
  despliegue, y lo que cambia por empresa es a cuáles entra y con qué rol. Un
  mismo nombre de usuario no puede pertenecer a dos personas distintas en dos
  empresas.
- **El catálogo de roles es global**: «Soporte TI» es un único rol con unos
  permisos, y lo que se decide por empresa es a quién se le da. Roles con
  distinto contenido según la empresa serían otra fase.
- **La identidad visual es global**: el logo, el nombre y los colores son los
  mismos para todas. Si cada empresa debe tener el suyo, el tema pasa a ser por
  empresa.
- **La auditoría es global**: registra quién hizo qué, sin acotarse por empresa.
  Los cambios de empresa sí quedan registrados (`empresa.created`,
  `empresa.updated`, `user.empresas_assigned`).
