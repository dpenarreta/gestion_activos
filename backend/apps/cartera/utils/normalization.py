"""Normalización de encabezados y valores de texto (sección 6 de la especificación)."""

import re
import unicodedata

SIN_GESTION = 'SIN GESTIÓN'
SIN_RECUPERADOR = 'SIN RECUPERADOR ASIGNADO'
SIN_CIUDAD = 'SIN CIUDAD'


def strip_accents(value):
    if not value:
        return ''
    return ''.join(
        c for c in unicodedata.normalize('NFKD', value) if not unicodedata.combining(c)
    )


def normalize_header(value):
    """Clave canónica de comparación: minúsculas, sin tildes, sin guiones bajos, espacios colapsados."""
    if value is None:
        return ''
    text = str(value)
    text = strip_accents(text)
    text = text.lower()
    text = text.replace('_', ' ').replace('-', ' ')
    text = re.sub(r'[^a-z0-9\s/]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def normalize_text(value):
    """Limpia espacios de un valor de texto sin cambiar mayúsculas/tildes."""
    if value is None:
        return ''
    text = str(value)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def is_blank(value):
    if value is None:
        return True
    return normalize_text(value) == ''


def normalize_causal(value):
    text = normalize_text(value)
    if not text:
        return SIN_GESTION
    return text.upper()


def normalize_recuperador(value):
    text = normalize_text(value)
    if not text:
        return SIN_RECUPERADOR
    return text


def normalize_ciudad(value):
    text = normalize_text(value)
    if not text:
        return SIN_CIUDAD
    return text.upper()


def normalize_cliente_key(value):
    text = normalize_text(value)
    return strip_accents(text).upper()
