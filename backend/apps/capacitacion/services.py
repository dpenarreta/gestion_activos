"""Las reglas del onboarding y la capacitación.

- **El plan** de una persona: los materiales activos de la empresa, los de su
  área (la unidad de su cargo en el organigrama) y los de su cargo.
- **Evaluarse** pide haber abierto el material. Cada intento se califica sobre
  100; se aprueba con la nota mínima del material; hay un máximo de intentos
  (Talento Humano puede devolverlos). Las respuestas correctas no se revelan.
- **El onboarding** se asigna al entrar a una empresa (no a las cuentas que ya
  estaban) con una fecha límite, y se completa al aprobar todo el plan.
  Talento Humano puede asignarlo a mano a quien ya tenía cuenta.
- **Oportunidades de mejora**: las preguntas que más se fallan, por persona y
  por material.
"""

import datetime

from django.conf import settings
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.empresas.contexto import usando_empresa
from apps.empresas.models import MembresiaEmpresa
from apps.notificaciones import services as campana
from apps.permissions.authorization import user_has_permission

from .models import Intento, Material, Onboarding, Opcion, Pregunta, VistaMaterial
from .serializers import formatos

ENLACE = "/admin/institucional/onboarding"


def dias_de_plazo() -> int:
    return int(getattr(settings, "CAPACITACION_DIAS_PLAZO", 15))


def gestiona(usuario) -> bool:
    return user_has_permission(usuario, "capacitacion.gestionar")


def ve_resultados(usuario) -> bool:
    return user_has_permission(usuario, "capacitacion.resultados")


# --- El plan de cada persona -------------------------------------------------------------


def cargo_de(usuario):
    from apps.organizacion.models import DatosDeContacto

    perfil = (
        DatosDeContacto.objects.filter(usuario=usuario, cargo__isnull=False)
        .select_related("cargo")
        .first()
    )
    return perfil.cargo if perfil else None


def plan_de(usuario):
    """Los materiales que le tocan, en orden: empresa, área, cargo."""
    from django.db.models import Q

    cargo = cargo_de(usuario)
    filtro = Q(alcance=Material.Alcance.EMPRESA)
    if cargo is not None:
        filtro |= Q(alcance=Material.Alcance.CARGO, cargo=cargo)
        if cargo.unidad_id:
            filtro |= Q(alcance=Material.Alcance.UNIDAD, unidad_id=cargo.unidad_id)
    orden = {Material.Alcance.EMPRESA: 0, Material.Alcance.UNIDAD: 1, Material.Alcance.CARGO: 2}
    materiales = list(
        Material.objects.filter(filtro, activo=True)
        .select_related("unidad", "cargo")
        .prefetch_related("preguntas")
    )
    return sorted(materiales, key=lambda m: (orden[m.alcance], m.orden, m.titulo))


def estado_material(usuario, material, vistos=None, intentos=None) -> dict:
    vistos = (
        vistos
        if vistos is not None
        else set(
            VistaMaterial.objects.filter(usuario=usuario).values_list("material_id", flat=True)
        )
    )
    if intentos is None:
        intentos = list(Intento.objects.filter(usuario=usuario, material=material, anulado=False))
    propios = [i for i in intentos if i.material_id == material.pk]
    mejor = max((i.puntaje for i in propios), default=None)
    aprobado = any(i.aprobado for i in propios)
    restantes = max(material.intentos_max - len(propios), 0)
    return {
        "visto": material.pk in vistos,
        "intentos": len(propios),
        "intentos_restantes": 0 if aprobado else restantes,
        "mejor_puntaje": mejor,
        "aprobado": aprobado,
        "agotado": not aprobado and restantes == 0,
    }


def _material(m) -> dict:
    return {
        "id": m.id,
        "titulo": m.titulo,
        "descripcion": m.descripcion,
        "alcance": m.alcance,
        "alcance_display": m.get_alcance_display(),
        "de": (
            m.unidad.nombre
            if m.alcance == Material.Alcance.UNIDAD and m.unidad_id
            else (m.cargo.nombre if m.alcance == Material.Alcance.CARGO and m.cargo_id else "")
        ),
        "formatos": formatos(m),
        "url": m.url,
        "contenido": m.contenido,
        "tiene_archivo": bool(m.archivo),
        "archivo_nombre": m.archivo_nombre,
        "archivo_es_pdf": m.archivo_tipo == "application/pdf",
        "nota_minima": m.nota_minima,
        "intentos_max": m.intentos_max,
        "preguntas": len(m.preguntas.all()),
    }


def progreso(usuario) -> dict:
    """Su onboarding: el plan con el estado de cada material y el resumen."""
    onboarding = Onboarding.objects.filter(usuario=usuario).first()
    materiales = plan_de(usuario)
    vistos = set(
        VistaMaterial.objects.filter(usuario=usuario).values_list("material_id", flat=True)
    )
    intentos = list(Intento.objects.filter(usuario=usuario, anulado=False))
    filas = [{**_material(m), **estado_material(usuario, m, vistos, intentos)} for m in materiales]
    aprobados = sum(1 for f in filas if f["aprobado"])
    puntajes = [f["mejor_puntaje"] for f in filas if f["mejor_puntaje"] is not None]
    hoy = timezone.localdate()
    return {
        "asignado": onboarding is not None,
        "fecha_limite": onboarding.fecha_limite if onboarding else None,
        "completado_en": onboarding.completado_en if onboarding else None,
        "vencido": bool(
            onboarding and not onboarding.completado_en and onboarding.fecha_limite < hoy
        ),
        "total": len(filas),
        "aprobados": aprobados,
        "promedio": round(sum(puntajes) / len(puntajes)) if puntajes else None,
        "materiales": filas,
    }


def _del_plan(usuario, material_id) -> Material:
    for m in plan_de(usuario):
        if m.pk == int(material_id):
            return m
    raise NotFound("Ese material no está en su plan de capacitación.")


def marcar_visto(usuario, material_id) -> Material:
    material = _del_plan(usuario, material_id)
    VistaMaterial.objects.get_or_create(usuario=usuario, material=material)
    return material


def evaluacion(usuario, material_id) -> dict:
    """Las preguntas para responder (sin decir cuál es la correcta)."""
    material = _del_plan(usuario, material_id)
    estado = estado_material(usuario, material)
    if not estado["visto"]:
        raise ValidationError({"detail": "Revise el material antes de evaluarse."})
    if estado["aprobado"]:
        raise ValidationError({"detail": "Ya aprobó esta evaluación."})
    if estado["agotado"]:
        raise ValidationError(
            {"detail": "Usó todos sus intentos. Pida a Talento Humano que se los devuelva."}
        )
    preguntas = material.preguntas.prefetch_related("opciones")
    if not preguntas.exists():
        raise ValidationError({"detail": "Este material todavía no tiene evaluación."})
    return {
        "material": {
            "id": material.id,
            "titulo": material.titulo,
            "nota_minima": material.nota_minima,
        },
        "intentos_restantes": estado["intentos_restantes"],
        "preguntas": [
            {
                "id": p.id,
                "texto": p.texto,
                "opciones": [{"id": o.id, "texto": o.texto} for o in p.opciones.all()],
            }
            for p in preguntas
        ],
    }


@transaction.atomic
def responder(usuario, material_id, respuestas: dict) -> dict:
    """Califica un intento (`{pregunta_id: opcion_id}`) sobre 100."""
    evaluacion(usuario, material_id)  # mismas condiciones para responder
    material = Material.objects.get(pk=material_id)
    preguntas = list(material.preguntas.prefetch_related("opciones"))
    falladas = []
    for p in preguntas:
        elegida = respuestas.get(str(p.id)) or respuestas.get(p.id)
        correctas = {o.id for o in p.opciones.all() if o.correcta}
        if not elegida or int(elegida) not in correctas:
            falladas.append(p)
    puntaje = round(100 * (len(preguntas) - len(falladas)) / len(preguntas))
    aprobado = puntaje >= material.nota_minima
    Intento.objects.create(
        usuario=usuario,
        material=material,
        puntaje=puntaje,
        aprobado=aprobado,
        falladas=",".join(str(p.id) for p in falladas),
    )
    _revisar_si_completo(usuario)
    estado = estado_material(usuario, material)
    return {
        "puntaje": puntaje,
        "aprobado": aprobado,
        "nota_minima": material.nota_minima,
        "intentos_restantes": estado["intentos_restantes"],
        # Oportunidades de mejora: qué falló (no cuál era la correcta).
        "a_reforzar": [p.texto for p in falladas],
    }


def _revisar_si_completo(usuario):
    onboarding = Onboarding.objects.filter(usuario=usuario, completado_en__isnull=True).first()
    if onboarding is None:
        return
    resumen = progreso(usuario)
    if resumen["total"] and resumen["aprobados"] == resumen["total"]:
        onboarding.completado_en = timezone.now()
        onboarding.save(update_fields=["completado_en", "updated_at"])


# --- Asignar el onboarding ---------------------------------------------------------------


def asignar(usuario, actor=None, dias=None) -> Onboarding:
    onboarding, creado = Onboarding.objects.get_or_create(
        usuario=usuario,
        defaults={
            "fecha_limite": timezone.localdate() + datetime.timedelta(days=dias or dias_de_plazo()),
            "asignado_por": actor,
        },
    )
    # Solo se avisa si hay algo que hacer: un plan vacío no es una tarea.
    if creado and plan_de(usuario):
        campana.notificar(
            [usuario],
            tipo="capacitacion.onboarding",
            titulo="Tiene su onboarding de capacitación pendiente",
            resumen=f"Complételo antes del {onboarding.fecha_limite:%d/%m/%Y}.",
            enlace=ENLACE,
        )
    return onboarding


@receiver(post_save, sender=MembresiaEmpresa, dispatch_uid="capacitacion.asignar_onboarding")
def asignar_al_entrar(sender, instance, created, **kwargs):
    """Quien entra a una empresa recibe su onboarding."""
    if not created or not instance.usuario.is_active:
        return
    with usando_empresa(instance.empresa):
        asignar(instance.usuario)


# --- Materiales (quien gestiona) ---------------------------------------------------------


@transaction.atomic
def guardar_preguntas(material, preguntas: list[dict]):
    """Reemplaza la evaluación: cada pregunta con sus opciones y al menos una
    correcta."""
    for i, p in enumerate(preguntas, start=1):
        opciones = [o for o in p.get("opciones", []) if (o.get("texto") or "").strip()]
        if not (p.get("texto") or "").strip():
            raise ValidationError({"preguntas": f"La pregunta {i} no tiene texto."})
        if len(opciones) < 2:
            raise ValidationError({"preguntas": f"La pregunta {i} necesita al menos dos opciones."})
        if not any(o.get("correcta") for o in opciones):
            raise ValidationError(
                {"preguntas": f"Marque la respuesta correcta de la pregunta {i}."}
            )
    material.preguntas.all().delete()
    for i, p in enumerate(preguntas, start=1):
        pregunta = Pregunta.objects.create(
            material=material, texto=p["texto"].strip()[:500], orden=i
        )
        for j, o in enumerate(
            [o for o in p["opciones"] if (o.get("texto") or "").strip()], start=1
        ):
            Opcion.objects.create(
                pregunta=pregunta,
                texto=o["texto"].strip()[:300],
                correcta=bool(o.get("correcta")),
                orden=j,
            )


def preguntas_completas(material) -> list[dict]:
    """La evaluación con las correctas, para editarla."""
    return [
        {
            "id": p.id,
            "texto": p.texto,
            "opciones": [
                {"id": o.id, "texto": o.texto, "correcta": o.correcta} for o in p.opciones.all()
            ],
        }
        for p in material.preguntas.prefetch_related("opciones")
    ]


# --- Resultados (Talento Humano) ---------------------------------------------------------


def resultados() -> list[dict]:
    """Cada persona con onboarding: avance, promedio, vencido y sus materiales
    más débiles."""
    filas = []
    for onboarding in Onboarding.objects.select_related("usuario").order_by(
        "completado_en", "fecha_limite"
    ):
        usuario = onboarding.usuario
        resumen = progreso(usuario)
        debiles = sorted(
            [
                m
                for m in resumen["materiales"]
                if m["mejor_puntaje"] is not None and not m["aprobado"]
            ],
            key=lambda m: m["mejor_puntaje"],
        )
        filas.append(
            {
                "usuario": {
                    "id": usuario.id,
                    "nombre": usuario.get_full_name().strip() or usuario.username,
                    "correo": usuario.email,
                },
                "fecha_limite": onboarding.fecha_limite,
                "completado_en": onboarding.completado_en,
                "vencido": resumen["vencido"],
                "total": resumen["total"],
                "aprobados": resumen["aprobados"],
                "promedio": resumen["promedio"],
                "materiales": resumen["materiales"],
                "a_reforzar": [m["titulo"] for m in debiles],
            }
        )
    return filas


def estadisticas() -> list[dict]:
    """Por material: cuántos lo rindieron, promedio, aprobados y las preguntas
    que más se fallan (oportunidades de mejora de la capacitación)."""
    filas = []
    for material in Material.objects.prefetch_related("preguntas", "intentos"):
        # Todos los intentos, también los devueltos: lo que se falló cuenta
        # para saber qué reforzar en la capacitación.
        intentos = list(material.intentos.all())
        personas = {i.usuario_id for i in intentos}
        aprobaron = {i.usuario_id for i in intentos if i.aprobado}
        conteo = {}
        for i in intentos:
            for pid in filter(None, i.falladas.split(",")):
                conteo[int(pid)] = conteo.get(int(pid), 0) + 1
        textos = {p.id: p.texto for p in material.preguntas.all()}
        filas.append(
            {
                "id": material.id,
                "titulo": material.titulo,
                "alcance_display": material.get_alcance_display(),
                "personas": len(personas),
                "aprobaron": len(aprobaron),
                "promedio": (
                    round(sum(i.puntaje for i in intentos) / len(intentos)) if intentos else None
                ),
                "mas_falladas": [
                    {"pregunta": textos.get(pid, "(pregunta eliminada)"), "veces": veces}
                    for pid, veces in sorted(conteo.items(), key=lambda x: -x[1])[:5]
                ],
            }
        )
    return filas


def devolver_intentos(actor, usuario_id, material_id):
    if not ve_resultados(actor):
        raise PermissionDenied("No tiene el permiso requerido: capacitacion.resultados.")
    Intento.objects.filter(usuario_id=usuario_id, material_id=material_id, anulado=False).update(
        anulado=True
    )
