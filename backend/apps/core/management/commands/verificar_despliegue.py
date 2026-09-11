"""Revisión previa al despliegue: qué falta para que esto funcione en serio.

Django trae `check --deploy`, que revisa la configuración de seguridad del
framework. Esto revisa lo otro: lo que el sistema necesita **de fuera** para
cumplir lo que promete. Un sistema que envía alertas por correo sin servidor
SMTP, o que calcula sugerencias de renovación con un cron que nadie programó,
no falla — funciona en silencio y no avisa a nadie, que es peor.

Cada comprobación dice qué pasa si no se atiende, no solo que está mal. La
lista sale de `docs/puesta-en-marcha.md`, y este comando existe para que esa
lista se pueda verificar en vez de leerse.

Devuelve código de salida 1 si hay algo crítico, para poder encadenarlo en un
script de despliegue.
"""

from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand
from django.utils import timezone

#: Cuántos días sin correr hacen sospechar que una tarea programada no está.
DIAS_TOLERANCIA_CRON = 3


class Resultado:
    OK = "ok"
    AVISO = "aviso"
    CRITICO = "critico"


class Command(BaseCommand):
    help = "Revisa lo que el sistema necesita del entorno para funcionar de verdad."

    def handle(self, *args, **opciones):
        hallazgos = []
        hallazgos += self._revisar_configuracion()
        hallazgos += self._revisar_correo()
        hallazgos += self._revisar_tareas_programadas()
        hallazgos += self._revisar_datos_minimos()
        hallazgos += self._revisar_respaldos()
        hallazgos += self._revisar_datos_de_demostracion()

        criticos = [h for h in hallazgos if h[0] == Resultado.CRITICO]
        avisos = [h for h in hallazgos if h[0] == Resultado.AVISO]

        for estado, titulo, detalle in hallazgos:
            if estado == Resultado.OK:
                self.stdout.write(self.style.SUCCESS(f"  [ok]      {titulo}"))
            elif estado == Resultado.AVISO:
                self.stdout.write(self.style.WARNING(f"  [aviso]   {titulo}"))
                self.stdout.write(f"            {detalle}")
            else:
                self.stdout.write(self.style.ERROR(f"  [CRITICO] {titulo}"))
                self.stdout.write(f"            {detalle}")

        self.stdout.write(
            f"\n{len(hallazgos)} comprobaciones: {len(criticos)} criticas, {len(avisos)} avisos."
        )
        if criticos:
            self.stdout.write(self.style.ERROR("\nNo despliegue sin resolver lo critico."))
            raise SystemExit(1)

    # --- Configuración del entorno ---

    def _revisar_configuracion(self):
        hallazgos = []

        if settings.DEBUG:
            hallazgos.append(
                (
                    Resultado.CRITICO,
                    "DEBUG esta encendido",
                    "Cualquier error mostrara la traza completa, con rutas y fragmentos "
                    "de configuracion, a quien lo provoque.",
                )
            )
        else:
            hallazgos.append((Resultado.OK, "DEBUG apagado", ""))

        if not settings.ALLOWED_HOSTS or settings.ALLOWED_HOSTS == ["*"]:
            hallazgos.append(
                (
                    Resultado.CRITICO,
                    "ALLOWED_HOSTS sin acotar",
                    "Permite servir el sitio bajo cualquier dominio, lo que habilita "
                    "envenenamiento de cabecera Host.",
                )
            )
        else:
            hallazgos.append(
                (Resultado.OK, f"ALLOWED_HOSTS acotado ({len(settings.ALLOWED_HOSTS)})", "")
            )

        clave = settings.SECRET_KEY or ""
        if len(clave) < 40 or "insecure" in clave or "change" in clave.lower():
            hallazgos.append(
                (
                    Resultado.CRITICO,
                    "SECRET_KEY debil o de ejemplo",
                    "Con ella se firman los tokens de sesion: quien la conozca puede "
                    "emitir uno valido para cualquier usuario.",
                )
            )
        else:
            hallazgos.append((Resultado.OK, "SECRET_KEY propia", ""))

        return hallazgos

    # --- Datos de demostración ---

    def _revisar_datos_de_demostracion(self):
        """Que ninguna cuenta de demostración haya sobrevivido al camino.

        Se crearon para recorrer el sistema antes de producción y su clave se
        imprimió en una consola. Si llegan al despliegue real son cuentas
        conocidas —dos de ellas administran una empresa— y nadie se acuerda de
        borrarlas el día que hay prisa. Por eso se comprueba aquí y no en un
        recordatorio del manual.
        """
        from apps.core.management.commands.sembrar_datos_demo import usuarios_demo
        from apps.users.models import User

        presentes = list(
            User.objects.filter(username__in=usuarios_demo()).values_list("username", flat=True)
        )
        hallazgos = []
        if presentes:
            hallazgos.append(
                (
                    Resultado.CRITICO,
                    f"Quedan {len(presentes)} cuenta(s) de demostracion",
                    "Su clave se imprimio en una consola y algunas administran una "
                    "empresa: "
                    + ", ".join(sorted(presentes)[:5])
                    + ". Retirelas con: python manage.py sembrar_datos_demo --eliminar",
                )
            )

        # Las de extremo a extremo se crean y se borran en cada ejecucion, pero
        # un Ctrl+C a mitad deja la cuenta puesta —y lleva todos los permisos
        # del catalogo—. Es barato comprobarlo aqui.
        de_pruebas = list(
            User.objects.filter(username__startswith="e2e_").values_list("username", flat=True)
        )
        if de_pruebas:
            hallazgos.append(
                (
                    Resultado.CRITICO,
                    f"Quedan {len(de_pruebas)} cuenta(s) de pruebas automatizadas",
                    "Las crea la suite de extremo a extremo y llevan todos los permisos: "
                    + ", ".join(sorted(de_pruebas)[:5])
                    + ". Borrelas desde Usuarios.",
                )
            )

        if hallazgos:
            return hallazgos
        return [(Resultado.OK, "Sin cuentas de demostracion ni de pruebas", "")]

    # --- Correo ---

    def _revisar_correo(self):
        from apps.alertas.models import ConfiguracionAlertas
        from apps.alertas.services import destinatarios_vigentes

        hallazgos = []
        backend = settings.EMAIL_BACKEND

        configuracion = ConfiguracionAlertas.cargar()
        if "console" in backend or "locmem" in backend:
            estado = Resultado.CRITICO if configuracion.notificaciones_activas else Resultado.AVISO
            hallazgos.append(
                (
                    estado,
                    "EMAIL_BACKEND no envia correo de verdad",
                    "El envio se da por exitoso y el mensaje se imprime en el log: la "
                    "bitacora dira que salio y nadie lo habra recibido."
                    + (
                        " Las notificaciones de alertas estan ACTIVAS."
                        if configuracion.notificaciones_activas
                        else " (Las notificaciones estan apagadas, por eso es solo aviso.)"
                    ),
                )
            )
        else:
            hallazgos.append((Resultado.OK, f"Correo por {settings.EMAIL_HOST}", ""))

        remitente = settings.DEFAULT_FROM_EMAIL or ""
        if remitente.endswith(".local") or "xn--" in remitente:
            hallazgos.append(
                (
                    Resultado.AVISO,
                    f"DEFAULT_FROM_EMAIL no es un dominio real ({remitente})",
                    "Un remitente que no resuelve termina en la carpeta de correo no "
                    "deseado, donde un aviso no avisa a nadie.",
                )
            )
        else:
            hallazgos.append((Resultado.OK, f"Remitente {remitente}", ""))

        if configuracion.notificaciones_activas and not destinatarios_vigentes(configuracion):
            hallazgos.append(
                (
                    Resultado.AVISO,
                    "Notificaciones activas sin destinatarios validos",
                    "El envio se omite cada dia: el parque parece vigilado y no lo esta.",
                )
            )

        return hallazgos

    # --- Tareas programadas ---

    def _revisar_tareas_programadas(self):
        from apps.activos.models import Activo
        from apps.alertas.models import ConfiguracionAlertas, EnvioAlertas

        hallazgos = []
        limite = timezone.now() - timedelta(days=DIAS_TOLERANCIA_CRON)

        # `recalcular_indicadores`: sin el, la sugerencia de renovacion por
        # longevidad nunca se enciende, porque se cumple por el paso del tiempo
        # y ningun evento la dispara.
        ultima_evaluacion = (
            Activo.objects.filter(renovacion_evaluada_en__isnull=False)
            .order_by("-renovacion_evaluada_en")
            .values_list("renovacion_evaluada_en", flat=True)
            .first()
        )
        if ultima_evaluacion is None or ultima_evaluacion < limite:
            hallazgos.append(
                (
                    Resultado.AVISO,
                    "`recalcular_indicadores` no parece estar programado",
                    "Sin el, un equipo que nadie toca nunca aparecera como proximo a "
                    "reemplazo: ese criterio se cumple por el paso del tiempo."
                    + (
                        f" Ultima evaluacion: {ultima_evaluacion:%Y-%m-%d}."
                        if ultima_evaluacion
                        else " No consta ninguna evaluacion."
                    ),
                )
            )
        else:
            hallazgos.append(
                (Resultado.OK, f"Indicadores recalculados el {ultima_evaluacion:%Y-%m-%d}", "")
            )

        # `enviar_alertas`: cada pasada deja una fila, aunque no envie nada.
        configuracion = ConfiguracionAlertas.cargar()
        if configuracion.notificaciones_activas:
            ultimo_intento = EnvioAlertas.objects.order_by("-created_at").first()
            if ultimo_intento is None or ultimo_intento.created_at < limite:
                hallazgos.append(
                    (
                        Resultado.AVISO,
                        "`enviar_alertas` no parece estar programado",
                        "Las notificaciones estan activas pero no consta ninguna pasada "
                        "reciente: nadie esta recibiendo el resumen.",
                    )
                )
            else:
                hallazgos.append(
                    (
                        Resultado.OK,
                        f"Envio de alertas ejecutado el {ultimo_intento.created_at:%Y-%m-%d}",
                        "",
                    )
                )

        return hallazgos

    # --- Datos mínimos para operar ---

    def _revisar_datos_minimos(self):
        from apps.activos.models import Activo
        from apps.organizacion.models import Departamento
        from apps.users.models import User

        hallazgos = []

        if not Group.objects.exists():
            hallazgos.append(
                (
                    Resultado.AVISO,
                    "No hay roles definidos",
                    "Todo el mundo trabajara como superusuario. Ejecute "
                    "`manage.py crear_roles_iniciales`.",
                )
            )
        else:
            hallazgos.append((Resultado.OK, f"{Group.objects.count()} roles definidos", ""))

        superusuarios = User.objects.filter(is_superuser=True, is_active=True).count()
        if superusuarios > 3:
            hallazgos.append(
                (
                    Resultado.AVISO,
                    f"{superusuarios} superusuarios activos",
                    "El superusuario se salta el catalogo de permisos entero. Use roles "
                    "para el trabajo diario.",
                )
            )

        if not Departamento.objects.exists():
            hallazgos.append(
                (
                    Resultado.AVISO,
                    "No hay departamentos",
                    "Ningun activo se puede registrar sin area a la que adscribirlo.",
                )
            )

        total_activos = Activo.objects.count()
        if total_activos < 10:
            hallazgos.append(
                (
                    Resultado.AVISO,
                    f"Solo {total_activos} activos registrados",
                    "El levantamiento del inventario inicial es el riesgo numero uno del "
                    "documento funcional: sin datos reales, el sistema no sirve a nadie.",
                )
            )
        else:
            hallazgos.append((Resultado.OK, f"{total_activos} activos en el inventario", ""))

        return hallazgos

    # --- Copias de seguridad ---

    def _revisar_respaldos(self):
        """Un sistema sin respaldo reciente no falla: simplemente no tiene de
        dónde volver."""
        from apps.core.management.commands.respaldar import fecha_del_ultimo_respaldo

        ultimo = fecha_del_ultimo_respaldo()
        if ultimo is None:
            return [
                (
                    Resultado.AVISO,
                    "No consta ningun respaldo",
                    "La base y los adjuntos —facturas y actas firmadas— no se regeneran. "
                    "Ejecute `manage.py respaldar` y programelo (ver docs/respaldos.md).",
                )
            ]

        dias = (timezone.localtime() - ultimo).days
        if dias > 7:
            return [
                (
                    Resultado.AVISO,
                    f"El ultimo respaldo es de hace {dias} dias",
                    "Lo que se pierda desde entonces no se recupera.",
                )
            ]
        return [(Resultado.OK, f"Respaldo del {ultimo:%Y-%m-%d}", "")]
