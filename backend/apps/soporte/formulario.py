"""El formulario público configurable de la mesa de ayuda.

Cada empresa decide qué pregunta su formulario (menú Mesa de ayuda →
Formulario): cambia el texto y el orden de los campos del sistema, oculta los
que no necesita y agrega los suyos. Aquí vive lo que sostiene esa regla: que
los campos del sistema existan siempre, lo que ve el formulario y cómo se
valida lo que llega.
"""

from datetime import date
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as ErrorDeDjango
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Max
from rest_framework import serializers

from .models import CampoFormulario

#: Cuántos campos propios puede tener un formulario: más ya no es un formulario.
MAXIMO_PROPIOS = 30
MAXIMO_OPCIONES = 50
LARGO_MAXIMO = {"texto": 200, "parrafo": 2000, "correo": 254, "telefono": 20}

#: Clave del campo del sistema → nombre del dato que recibe el formulario.
_DATO_DE_LA_CLAVE = {
    "nombre": "nombre",
    "telefono": "telefono",
    "correo": "correo",
    "sede": "sede",
    "area": "area",
    "caso": "caso",
    "descripcion": "descripcion",
}


def asegurar_base():
    """Crea los campos del sistema que le falten a la empresa actual.

    Se llama al leer el formulario: una empresa nueva, o una que existía antes
    de que el formulario fuera configurable, queda con el formulario de siempre.
    """
    existentes = set(CampoFormulario.objects.filter(base=True).values_list("clave", flat=True))
    if len(existentes) == len(CampoFormulario.BASE):
        return
    for posicion, (clave, (etiqueta, tipo)) in enumerate(CampoFormulario.BASE.items(), start=1):
        if clave in existentes:
            continue
        try:
            with transaction.atomic():
                CampoFormulario.objects.create(
                    clave=clave,
                    etiqueta=etiqueta,
                    tipo=tipo,
                    base=True,
                    obligatorio=True,
                    orden=posicion * 10,
                )
        except IntegrityError:
            # Otra petición lo creó al mismo tiempo, o ya existe una clave propia
            # igual (imposible desde la interfaz): se deja lo que hay.
            continue


def campos():
    """Todos los campos de la empresa actual, en orden, con los del sistema."""
    asegurar_base()
    return list(CampoFormulario.objects.prefetch_related("categorias").order_by("orden", "id"))


def describir(campo) -> dict:
    """Lo que el formulario público necesita saber de un campo."""
    return {
        "clave": campo.clave,
        "etiqueta": campo.etiqueta,
        "ayuda": campo.ayuda,
        "tipo": campo.tipo,
        "opciones": list(campo.opciones or []) if not campo.base else [],
        "obligatorio": campo.obligatorio,
        "base": campo.base,
        "categorias": [c.id for c in campo.categorias.all()],
    }


def visibles():
    """Los campos que muestra el formulario público."""
    return [describir(c) for c in campos() if c.activo]


def _vacio(valor) -> bool:
    return valor is None or (isinstance(valor, str) and not valor.strip())


def _normalizar(campo, valor):
    """Valida un valor según el tipo del campo y lo devuelve como texto."""
    if campo.tipo == CampoFormulario.Tipo.CASILLA:
        if isinstance(valor, bool):
            marcado = valor
        else:
            marcado = str(valor).strip().lower() in {"true", "1", "si", "sí", "on"}
        if campo.obligatorio and not marcado:
            raise serializers.ValidationError("Debe marcar esta casilla.")
        return "Sí" if marcado else "No"
    texto = str(valor).strip()
    if campo.tipo == CampoFormulario.Tipo.NUMERO:
        try:
            numero = Decimal(texto.replace(",", "."))
        except InvalidOperation as error:
            raise serializers.ValidationError("Escriba un número.") from error
        if not numero.is_finite():
            raise serializers.ValidationError("Escriba un número.")
        return format(numero.normalize(), "f")
    if campo.tipo == CampoFormulario.Tipo.FECHA:
        try:
            return date.fromisoformat(texto).isoformat()
        except ValueError as error:
            raise serializers.ValidationError("Escriba una fecha válida.") from error
    if campo.tipo == CampoFormulario.Tipo.LISTA:
        if texto not in (campo.opciones or []):
            raise serializers.ValidationError("Elija una de las opciones.")
        return texto
    if campo.tipo == CampoFormulario.Tipo.CORREO:
        try:
            validate_email(texto)
        except ErrorDeDjango as error:
            raise serializers.ValidationError("Escriba un correo válido.") from error
    if campo.tipo == CampoFormulario.Tipo.TELEFONO:
        digitos = [c for c in texto if c.isdigit()]
        if not 7 <= len(digitos) <= 15:
            raise serializers.ValidationError("Escriba un teléfono de 7 a 15 dígitos.")
    largo = LARGO_MAXIMO.get(campo.tipo, 200)
    if len(texto) > largo:
        raise serializers.ValidationError(f"Escriba como máximo {largo} caracteres.")
    return texto


def validar_envio(datos: dict, adicionales: dict) -> tuple[dict, list]:
    """Aplica el formulario de la empresa a lo que llegó.

    ``datos`` es lo ya validado de los campos del sistema; ``adicionales``, lo
    respondido en los propios (clave → valor). Devuelve los datos del sistema
    sin lo que el formulario oculta, y la copia de los propios que guarda el
    ticket. Si falta o sobra algo, lo dice campo por campo.
    """
    errores = {}
    datos = dict(datos)
    categoria = datos["caso"].categoria if datos.get("caso") else None
    respuestas = []
    for campo in campos():
        if campo.base:
            dato = _DATO_DE_LA_CLAVE.get(campo.clave)
            if dato is None:
                continue
            if not campo.activo:
                datos[dato] = None if dato in {"sede", "area"} else ""
            elif campo.obligatorio and _vacio(datos.get(dato)):
                errores[campo.clave] = ["Este campo es obligatorio."]
            continue
        if not campo.activo:
            continue
        filtro = {c.id for c in campo.categorias.all()}
        if filtro and (categoria is None or categoria.id not in filtro):
            continue
        valor = adicionales.get(campo.clave)
        if campo.tipo == CampoFormulario.Tipo.CASILLA:
            valor = valor or False  # sin marcar también es una respuesta
        elif _vacio(valor):
            if campo.obligatorio:
                errores[campo.clave] = ["Este campo es obligatorio."]
            continue
        try:
            texto = _normalizar(campo, valor)
        except serializers.ValidationError as error:
            errores[campo.clave] = error.detail
            continue
        respuestas.append({"clave": campo.clave, "etiqueta": campo.etiqueta, "valor": texto})
    if errores:
        raise serializers.ValidationError(errores)
    return datos, respuestas


def siguiente_orden() -> int:
    """El orden de un campo nuevo: al final, después de los del sistema."""
    asegurar_base()
    ultimo = CampoFormulario.objects.aggregate(m=Max("orden"))["m"] or 0
    return ultimo + 10


def ordenar(ids: list) -> None:
    """Deja los campos en el orden de ``ids``; los que no vienen van al final."""
    todos = {c.id: c for c in CampoFormulario.objects.all()}
    try:
        orden = [int(i) for i in ids]
    except (TypeError, ValueError) as error:
        raise serializers.ValidationError({"ids": "Envíe la lista de campos."}) from error
    desconocidos = [i for i in orden if i not in todos]
    if desconocidos:
        raise serializers.ValidationError({"ids": "Hay campos que no son de esta empresa."})
    resto = [i for i in sorted(todos, key=lambda i: (todos[i].orden, i)) if i not in orden]
    with transaction.atomic():
        for posicion, campo_id in enumerate(orden + resto, start=1):
            campo = todos[campo_id]
            if campo.orden != posicion * 10:
                campo.orden = posicion * 10
                campo.save(update_fields=["orden", "updated_at"])
