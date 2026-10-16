"""Interpretación del dashboard generada por IA — dos variantes que comparten la misma
descripción por componente (`_describir_componente`) y la misma llamada a Gemini:

- `generar_interpretacion`: un único párrafo narrativo de TODO el dashboard a la vez (botón
  "Interpretación completa" en `DashboardAreaPage.jsx`, antes de "Conectar vista de base de
  datos").
- `generar_hallazgos_ia`: un párrafo corto POR componente (`{component_id: texto}`), en un único
  llamado batch a Gemini (no uno por componente — evitaría N llamadas externas por cada carga de
  página). Reemplaza progresivamente, componente por componente, los "Hallazgos clave" generados
  con reglas fijas en el frontend (`frontend/src/utils/hallazgosClave.js`,
  `HallazgosClaveCard.jsx`), que siguen siendo el fallback instantáneo mientras este endpoint
  resuelve o si falla.

Ambas parten de los mismos datos ya calculados que sirve `serializar_layout` (`content` de cada
componente visible) — no reprocesan ningún archivo ni vuelven a consultar `RegistroCartera`. Ambas
también incluyen, si existe, `Dashboard.contexto` (`_bloque_contexto`) — texto libre que un
administrador carga al crear/editar el dashboard únicamente para orientar a la IA, nunca mostrado
dentro del dashboard — y, por componente, `config.instruccion_ia`/`config.contexto_ia`
(`_bloque_instruccion_ia`), cargados al crear un componente en Zona Personal
(`AgregarComponentePersonalModal.jsx`) para pedirle a la IA que lo interprete en términos de una
columna que no forma parte del gráfico en sí.
"""

import hashlib
import json
import logging
import re
import time

import requests
from django.conf import settings
from django.core.cache import cache

from ..exceptions import CarteraError
from ..models import Dashboard
from . import dashboard_layout as dl

logger = logging.getLogger(__name__)

# Vigencia de la caché de hallazgos. La clave ya es un hash del prompt, así que un cambio de datos
# o de diseño invalida la entrada por sí solo; este TTL solo acota cuánto vive una entrada que ya
# nadie va a volver a pedir. 12 horas cubre una jornada de trabajo.
_TTL_CACHE_HALLAZGOS_SEGUNDOS = 12 * 60 * 60

_GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
_TIMEOUT_SEGUNDOS = 45

# El servicio responde 503 UNAVAILABLE ("high demand… try again later") de forma intermitente, y
# no de manera pareja: midiendo seis modelos en el mismo minuto, tres respondieron 200 y tres 503.
# Sin reintento, un pico de dos segundos del lado de Google dejaba al dashboard sin hallazgos
# hasta que alguien recargara la pantalla.
_ESTADOS_REINTENTABLES = frozenset({429, 500, 502, 503, 504})
# Un modelo que no existe (404) no mejora esperando, pero el siguiente de la lista puede andar.
_ESTADO_MODELO_AUSENTE = 404
_ESPERA_ENTRE_INTENTOS_SEGUNDOS = 1.5
# Por debajo de los 60s que espera el frontend (`dashboardLayoutService.js::_TIMEOUT_IA_MS`), para
# que el backend alcance a responder su propio error antes de que el navegador aborte la petición.
_PRESUPUESTO_TOTAL_SEGUNDOS = 50
_MAXIMO_ITEMS_POR_COMPONENTE = 20


def _formatear_numero(valor):
    if isinstance(valor, float):
        return f'{valor:,.2f}'
    if isinstance(valor, int):
        return f'{valor:,}'
    return str(valor)


def _describir_kpi(content):
    texto = f'KPI "{content.get("titulo") or "(sin título)"}": valor = {_formatear_numero(content.get("valor"))}.'
    if content.get('descripcion'):
        texto += f' {content["descripcion"]}'
    return texto


def _describir_categorico(content):
    categorias = content.get('categorias') or []
    valores = content.get('valores') or []
    pares = list(zip(categorias, valores))[:_MAXIMO_ITEMS_POR_COMPONENTE]
    detalle = ', '.join(f'{c}: {_formatear_numero(v)}' for c, v in pares)
    truncado = ' (truncado a los primeros items)' if len(categorias) > _MAXIMO_ITEMS_POR_COMPONENTE else ''
    return f'Gráfico "{content.get("titulo") or "(sin título)"}" — {detalle}{truncado}.'


def _describir_multiserie(content):
    categorias = content.get('categorias') or []
    series = content.get('series') or []
    partes = []
    for serie in series:
        pares = list(zip(categorias, serie.get('valores') or []))[:_MAXIMO_ITEMS_POR_COMPONENTE]
        detalle = ', '.join(f'{c}: {_formatear_numero(v)}' for c, v in pares)
        partes.append(f'serie "{serie.get("nombre")}" ({detalle})')
    truncado = ' (truncado a los primeros items)' if len(categorias) > _MAXIMO_ITEMS_POR_COMPONENTE else ''
    return f'Gráfico multiserie "{content.get("titulo") or "(sin título)"}" — ' + '; '.join(partes) + f'{truncado}.'


def _describir_dispersion(content):
    puntos = (content.get('puntos') or [])[:_MAXIMO_ITEMS_POR_COMPONENTE]
    detalle = ', '.join(f'({p.get("x")}, {p.get("y")})' for p in puntos)
    truncado = ' (truncado a los primeros puntos)' if len(content.get('puntos') or []) > _MAXIMO_ITEMS_POR_COMPONENTE else ''
    return f'Gráfico de dispersión "{content.get("titulo") or "(sin título)"}" — puntos (x, y): {detalle}{truncado}.'


_MESES = (
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
)
# Cuántos deudores describir en la sección de mayores deudores. Cada uno aporta su propia
# mini-tabla de tramos, así que cuentan mucho más que un item de una lista plana.
_MAXIMO_DEUDORES = 5


def _describir_deudores(content):
    """La sección de los mayores deudores: una mini-tabla de antigüedad POR deudor.

    Su `content` no tiene `categorias`, `series`, `puntos` ni `columnas`/`filas` — tiene
    `deudores`, y cada deudor trae las suyas. Sin esta rama el despachador devolvía `None` y la
    sección entera quedaba FUERA del prompt: la IA no escribía su hallazgo y tampoco la tenía en
    cuenta al interpretar el dashboard completo, sin ningún aviso de que faltaba.
    """
    deudores = content.get('deudores') or []
    partes = []
    for deudor in deudores[:_MAXIMO_DEUDORES]:
        tramos = ', '.join(
            f'{fila[0]}: {_formatear_numero(fila[1])} ({_formatear_numero(fila[2])}% de su saldo)'
            for fila in (deudor.get('filas') or []) if len(fila) >= 3
        )
        partes.append(
            f'"{deudor.get("nombre")}" (saldo {_formatear_numero(deudor.get("total"))}, '
            f'{_formatear_numero(deudor.get("porcentaje_cartera"))}% de la cartera total; '
            f'tramo con mayor saldo: {deudor.get("tramo_mayor")}) — {tramos}'
        )
    truncado = f' (truncado a los {_MAXIMO_DEUDORES} primeros deudores)' if len(deudores) > _MAXIMO_DEUDORES else ''
    titulo = content.get('titulo') or '(sin título)'
    return f'Antigüedad por deudor "{titulo}" — ' + '; '.join(partes) + f'{truncado}.'


def _mes_y_anio(fecha_iso):
    """'2026-08-31' -> 'AGOSTO 2026'. Con un mapa propio y no con `strftime('%B')`, que depende
    del locale del sistema operativo y en el servidor devolvería el mes en inglés."""
    try:
        anio, mes, _dia = str(fecha_iso).split('-')
        return f'{_MESES[int(mes) - 1]} {anio}'.upper()
    except (ValueError, IndexError, AttributeError):
        return None


def _con_titulo_resuelto(componente, content, corte):
    """Resuelve los marcadores `{n}` y `{corte}` del título antes de mandarlo a la IA.

    El título se guarda con marcadores a propósito (si el número quedara escrito, seguiría
    diciendo "TOP 16" después de cambiarlo a 5, y "AGOSTO 2026" con el corte siguiente ya cargado),
    y el frontend los resuelve al dibujar. El prompt se arma del `content` crudo, así que la IA
    venía leyendo "ANTIGÜEDAD DE CARTERA — {corte}" y "TOP {n} CLIENTES": perdía la fecha del
    corte y el tamaño del top, y podía repetir el marcador en el texto del hallazgo.
    """
    titulo = str(content.get('titulo') or '')
    if '{' not in titulo:
        return content

    if '{n}' in titulo:
        mapeo = componente.get('mapeo') or {}
        cuantos = (
            mapeo.get('top_n') or mapeo.get('cuantos')
            or len(content.get('deudores') or content.get('filas') or []) or None
        )
        titulo = titulo.replace('{n}', str(cuantos)) if cuantos else titulo.replace('{n}', '')

    if '{corte}' in titulo:
        # Sin corte conocido se quita el marcador CON su puntuación, igual que en el frontend
        # (`formato.js::conCorte`): el informe lo usa como "— {corte}" y como "({corte})", y
        # dejarlo suelto daría un "— " o un "()" colgando.
        mes = _mes_y_anio(corte) if corte else None
        if mes:
            titulo = titulo.replace('{corte}', mes)
        else:
            titulo = re.sub(r'\s*—\s*\{corte\}', '', titulo)
            titulo = re.sub(r'\s*\(\{corte\}\)', '', titulo).replace('{corte}', '')

    return {**content, 'titulo': titulo.strip()}


def _corte_del_layout(componentes):
    """La fecha de corte vive en el componente marcado como base de porcentaje, igual que en el
    frontend (`formato.js::corteDe`) — no hay un campo del dashboard que la tenga."""
    for componente in componentes:
        if (componente.get('config') or {}).get('es_base_porcentaje'):
            return (componente.get('content') or {}).get('fecha_corte')
    return None


def _describir_tabla(content):
    columnas = content.get('columnas') or []
    filas = (content.get('filas') or [])[:_MAXIMO_ITEMS_POR_COMPONENTE]
    encabezado = ' | '.join(str(c) for c in columnas)
    filas_texto = ' / '.join(' | '.join(_formatear_numero(v) for v in fila) for fila in filas)
    truncado = ' (truncado a las primeras filas)' if len(content.get('filas') or []) > _MAXIMO_ITEMS_POR_COMPONENTE else ''
    total = content.get('total')
    texto = f'Tabla "{content.get("titulo") or "(sin título)"}" — columnas: {encabezado}. Filas: {filas_texto}{truncado}.'
    if total:
        texto += f' Total: {" | ".join(_formatear_numero(v) for v in total)}.'
    return texto


def _bloque_instruccion_ia(componente):
    """Instrucción libre + columna de contexto adicional que el usuario cargó al crear este
    componente en Zona Personal (`AgregarComponentePersonalModal.jsx` → `config.instruccion_ia`/
    `config.contexto_ia`, ver `dashboard_layout.agregar_componente_generado`) — pensado para
    pedirle a la IA que interprete el componente en términos de una columna que no forma parte del
    gráfico en sí (p. ej. "explicá los totales por la Causal de gestión"). `contexto_ia` ya viene
    calculado desde que se creó el componente (mismo criterio que el resto del `content`: una foto
    fija, no se recalcula contra el archivo en cada carga de página). Solo afecta lo que lee la IA
    (`_construir_prompt`/`_construir_prompt_hallazgos`) — nunca cambia qué datos se calculan ni
    cómo se dibuja el componente. Cadena vacía si no hay nada cargado."""
    config = componente.get('config') or {}
    instruccion = (config.get('instruccion_ia') or '').strip()
    contexto = config.get('contexto_ia') or {}
    if not instruccion and not contexto.get('categorias'):
        return ''
    partes = []
    if instruccion:
        partes.append(f'Instrucción del usuario para este componente: "{instruccion}".')
    if contexto.get('categorias'):
        pares = list(zip(contexto['categorias'], contexto.get('valores') or []))[:_MAXIMO_ITEMS_POR_COMPONENTE]
        detalle = ', '.join(f'{c}: {_formatear_numero(v)}' for c, v in pares)
        partes.append(f'Contexto adicional (desglose por "{contexto.get("columna")}"): {detalle}.')
    return ' ' + ' '.join(partes)


def _describir_componente(componente, corte=None):
    content = _con_titulo_resuelto(componente, componente.get('content') or {}, corte)
    if componente['type'] == 'kpi':
        return _describir_kpi(content) + _bloque_instruccion_ia(componente)
    if componente['type'] != 'chart':
        return None
    if 'puntos' in content:
        base = _describir_dispersion(content)
    elif 'deudores' in content:
        base = _describir_deudores(content)
    elif 'columnas' in content and 'filas' in content:
        base = _describir_tabla(content)
    elif 'series' in content:
        base = _describir_multiserie(content)
    elif 'categorias' in content:
        base = _describir_categorico(content)
    else:
        return None
    return base + _bloque_instruccion_ia(componente)


def _bloque_contexto(dashboard):
    """`Dashboard.contexto`: texto libre que un administrador carga al crear/editar el dashboard,
    pensado únicamente para orientar a la IA (qué es este dashboard, de dónde vienen los datos, qué
    matices tener en cuenta) — nunca se muestra dentro del dashboard en sí, a diferencia de
    `description`. Cadena vacía si no hay nada cargado, para no agregar una sección vacía al
    prompt."""
    if not dashboard.contexto:
        return ''
    return f'\nContexto adicional sobre este dashboard, provisto por un administrador:\n{dashboard.contexto}\n'


def _construir_prompt(dashboard, componentes_descritos):
    cuerpo = '\n'.join(f'- {texto}' for texto in componentes_descritos)
    return (
        'Sos un analista de datos redactando para un directivo que no vio el dashboard. '
        f'A continuación tenés los componentes (KPIs, gráficos y tablas) del dashboard '
        f'"{dashboard.name}" (área: {dashboard.area or "sin área"}), con sus datos ya calculados:\n\n'
        f'{cuerpo}\n'
        f'{_bloque_contexto(dashboard)}\n'
        'Redactá una interpretación completa y ejecutiva en español, en prosa clara (párrafos, no '
        'una lista mecánica de cada número), que resuma la situación general, destaque los '
        'hallazgos más relevantes (valores más altos/bajos, concentraciones, proporciones) y '
        'señale relaciones entre componentes si son evidentes a partir de los datos provistos. '
        'Si hay contexto adicional provisto por un administrador, usalo para interpretar mejor los '
        'datos (a qué corresponden, qué matices tener en cuenta), pero no lo repitas textualmente '
        'ni inventes datos que no estén en la información de arriba. Si algún componente trae una '
        '"Instrucción del usuario para este componente", seguila al pie de la letra para ese '
        'componente en particular, usando también el "Contexto adicional" que la acompañe si lo hay.'
    )


def _construir_prompt_hallazgos(dashboard, items):
    cuerpo = '\n'.join(f'- ID "{component_id}": {texto}' for component_id, texto in items)
    return (
        'Sos un analista de datos. Para cada componente del dashboard '
        f'"{dashboard.name}" (área: {dashboard.area or "sin área"}) listado abajo (con su ID y sus '
        'datos ya calculados), escribí un párrafo breve (1 a 3 oraciones) de "hallazgo clave": el '
        'punto más relevante que ESE componente en particular muestra, en español, con los números '
        'y nombres importantes resaltados entre **dobles asteriscos**. Analizá cada componente de '
        'forma independiente, sin compararlo con los demás. Si hay contexto adicional provisto por '
        'un administrador, usalo para interpretar mejor los datos, pero no inventes datos que no '
        'estén en la información provista. Si un componente trae una "Instrucción del usuario para '
        'este componente", seguila al pie de la letra para ESE componente, usando también el '
        '"Contexto adicional" que la acompañe si lo hay.\n'
        f'{_bloque_contexto(dashboard)}\n'
        f'Componentes:\n{cuerpo}\n\n'
        'Devolvé ÚNICAMENTE un objeto JSON plano (sin texto adicional, sin bloque de código) con '
        'esta forma exacta: {"<ID>": "<párrafo>", ...}, con exactamente una entrada por cada ID '
        'listado arriba, usando el ID tal cual (sin el prefijo "ID").'
    )


def _dashboard_y_componentes_visibles(dashboard_id, mensaje_sin_datos):
    if not settings.GEMINI_API_KEY:
        raise CarteraError(
            'La interpretación con IA no está configurada en este entorno.', codigo='IA_NO_CONFIGURADA',
        )

    try:
        dashboard = Dashboard.objects.get(dashboard_id=dashboard_id)
    except Dashboard.DoesNotExist:
        raise CarteraError('El dashboard indicado no existe.', codigo='DASHBOARD_NO_ENCONTRADO')

    layout = dl.obtener_o_crear_layout(dashboard_id)
    visibles = [c for c in dl.serializar_layout(layout)['components'] if c['is_visible']]
    corte = _corte_del_layout(visibles)
    items = [(c['component_id'], _describir_componente(c, corte)) for c in visibles]
    items = [(component_id, texto) for component_id, texto in items if texto]

    if not items:
        raise CarteraError(mensaje_sin_datos, codigo='SIN_DATOS')

    return dashboard, items


def _modelos_a_probar():
    """El modelo configurado primero, después los de respaldo, sin repetir."""
    modelos = [settings.GEMINI_MODEL]
    for modelo in settings.GEMINI_MODELOS_RESPALDO:
        if modelo and modelo not in modelos:
            modelos.append(modelo)
    return modelos


def _texto_de_la_respuesta(cuerpo):
    try:
        return cuerpo['candidates'][0]['content']['parts'][0]['text']
    except (KeyError, IndexError):
        logger.error('Respuesta inesperada del servicio de IA: %s', str(cuerpo)[:500])
        raise CarteraError(
            'El servicio de interpretación con IA no devolvió una respuesta utilizable.', codigo='IA_ERROR',
        )


def _llamar_gemini(payload):
    """Un intento por modelo, hasta que uno responda o se acabe el presupuesto de tiempo.

    Los 503 son por MODELO y no por cuenta: pasar al siguiente de la lista suele resolver en el
    acto, así que cada intento cambia de modelo en vez de repetir el mismo. Un 4xx que no sea 429
    ni 404 corta enseguida — es un problema del pedido, y repetirlo contra otro modelo solo gasta
    el tiempo que el usuario está esperando.
    """
    comenzo = time.monotonic()
    modelos = _modelos_a_probar()
    ultimo_estado = None

    for indice, modelo in enumerate(modelos):
        restante = _PRESUPUESTO_TOTAL_SEGUNDOS - (time.monotonic() - comenzo)
        if restante <= 1:
            break
        if indice:
            time.sleep(_ESPERA_ENTRE_INTENTOS_SEGUNDOS)

        try:
            # La credencial va en el encabezado `x-goog-api-key`, NUNCA como parámetro de URL: en
            # la cadena de consulta la capturaba todo lo que registra URLs (logs de proxy, trazas
            # de excepción de `requests`, monitoreo). Un encabezado no aparece en un registro de
            # acceso.
            respuesta = requests.post(
                _GEMINI_URL.format(model=modelo),
                headers={'x-goog-api-key': settings.GEMINI_API_KEY},
                json=payload,
                timeout=min(_TIMEOUT_SEGUNDOS, restante),
            )
        except requests.RequestException:
            # El detalle real del fallo de red queda en el log del servidor: la respuesta al
            # frontend es deliberadamente genérica, pero sin esto no había forma de diagnosticar.
            logger.warning('Falló la llamada al servicio de IA (modelo=%s)', modelo, exc_info=True)
            ultimo_estado = None
            continue

        if respuesta.status_code == 200:
            if indice:
                logger.info('El servicio de IA respondió con el modelo de respaldo "%s".', modelo)
            return _texto_de_la_respuesta(respuesta.json())

        ultimo_estado = respuesta.status_code
        reintentable = respuesta.status_code in _ESTADOS_REINTENTABLES
        ausente = respuesta.status_code == _ESTADO_MODELO_AUSENTE
        logger.warning(
            'El servicio de IA respondió %s con el modelo "%s": %s',
            respuesta.status_code, modelo, respuesta.text[:300],
        )
        if not reintentable and not ausente:
            break

    logger.error(
        'Ningún modelo de IA respondió (probados: %s; último estado: %s).',
        ', '.join(modelos), ultimo_estado,
    )
    if ultimo_estado is None:
        raise CarteraError(
            'No se pudo contactar al servicio de interpretación con IA. Intente nuevamente.', codigo='IA_ERROR',
        )
    raise CarteraError(
        'El servicio de interpretación con IA respondió con un error. Intente nuevamente.',
        codigo='IA_ERROR',
        detalles={'status_code': ultimo_estado},
    )


def generar_interpretacion(dashboard_id):
    dashboard, items = _dashboard_y_componentes_visibles(
        dashboard_id, 'Este dashboard no tiene componentes con datos para interpretar.',
    )
    prompt = _construir_prompt(dashboard, [texto for _, texto in items])
    texto = _llamar_gemini({'contents': [{'parts': [{'text': prompt}]}]})
    return texto.strip()


def generar_hallazgos_ia(dashboard_id):
    """Hallazgo clave por componente, con caché por versión de layout.

    Este endpoint se dispara AUTOMÁTICAMENTE al abrir o guardar un dashboard, con una llamada
    externa síncrona de hasta 45 segundos. Sin caché, cada recarga de pantalla era una llamada
    facturable y un hilo del servidor ocupado casi un minuto — recargar en bucle alcanzaba para
    gastar la cuota y agotar los hilos disponibles.

    La clave es un hash del PROMPT, no la versión del layout: el prompt se arma con los datos ya
    calculados de cada componente, así que cambia en cuanto cambian los datos o el diseño, y no
    depende de que toda recarga de archivo bumpee `DashboardLayout.version`. Mismo prompt, misma
    respuesta — servirla de caché es exacto, no una aproximación.
    """
    dashboard, items = _dashboard_y_componentes_visibles(
        dashboard_id, 'Este dashboard no tiene componentes con datos para generar hallazgos.',
    )
    prompt = _construir_prompt_hallazgos(dashboard, items)

    huella = hashlib.sha256(prompt.encode('utf-8')).hexdigest()[:32]
    clave_cache = f'hallazgos_ia:{dashboard_id}:{huella}'
    en_cache = cache.get(clave_cache)
    if en_cache is not None:
        return en_cache

    texto_json = _llamar_gemini({
        'contents': [{'parts': [{'text': prompt}]}],
        'generationConfig': {'responseMimeType': 'application/json'},
    })

    try:
        hallazgos = json.loads(texto_json)
    except json.JSONDecodeError:
        raise CarteraError(
            'El servicio de interpretación con IA no devolvió una respuesta utilizable.', codigo='IA_ERROR',
        )
    if not isinstance(hallazgos, dict):
        raise CarteraError(
            'El servicio de interpretación con IA no devolvió una respuesta utilizable.', codigo='IA_ERROR',
        )

    ids_validos = {component_id for component_id, _ in items}
    resultado = {
        component_id: texto for component_id, texto in hallazgos.items()
        if component_id in ids_validos and isinstance(texto, str) and texto.strip()
    }
    cache.set(clave_cache, resultado, _TTL_CACHE_HALLAZGOS_SEGUNDOS)
    return resultado
