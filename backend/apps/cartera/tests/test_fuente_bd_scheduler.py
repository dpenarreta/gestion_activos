"""Actualización automática de "Conectar vista de base de datos" (`services/fuente_bd_scheduler.py`
+ `manage.py actualizar_fuentes_bd`) — sin ningún programador de tareas propio de la app, todo lo
que decide "a quién le toca hoy" y "cómo se reaplica sin intervención humana" vive acá. `db_source`
siempre mockeado, nunca se conecta a una base real."""

import decimal
from datetime import date
from unittest import mock

from django.test import TestCase
from django.core.management import call_command

from apps.cartera.exceptions import CarteraError
from apps.cartera.models import CargaArchivo, Dashboard, FilaArchivoHistorico
from apps.cartera.services import fuente_bd_scheduler
from apps.cartera.services.dashboards import actualizar_fuente_bd, crear_dashboard


class _ConFuenteBD(TestCase):
    """Un dashboard con fuente de base de datos y las dos fechas que gobiernan el atraso puestas a
    mano: `fuente_bd_fecha_configuracion` (que en producción es "hoy", inservible para una prueba
    con fechas fijas) y `fuente_bd_ultima_actualizacion_automatica`."""

    def _dashboard(self, configurado_el=None, ultima_corrida=None, **overrides):
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x', **overrides)
        campos = {}
        if configurado_el is not None:
            campos['fuente_bd_fecha_configuracion'] = configurado_el
        if ultima_corrida is not None:
            campos['fuente_bd_ultima_actualizacion_automatica'] = ultima_corrida
        if campos:
            Dashboard.objects.filter(dashboard_id=dashboard.dashboard_id).update(**campos)
        dashboard.refresh_from_db()
        return dashboard


class DebeActualizarseHoyTests(_ConFuenteBD):
    """Lo que se decide acá no es "¿hoy es el día?" sino "¿quedó pendiente?".

    El disparador es el programador de tareas del sistema operativo y puede no correr (servidor
    apagado, máquina dormida, tarea deshabilitada). Con la pregunta vieja, un domingo perdido
    costaba el período entero: el dashboard seguía mostrando datos viejos hasta el domingo
    siguiente, sin reintento y sin ningún error que lo delatara.
    """

    def test_sin_fuente_configurada_nunca_corresponde(self):
        dashboard = crear_dashboard(nombre='Cobranza')  # sin tipo/nombre
        self.assertFalse(fuente_bd_scheduler.debe_actualizarse_hoy(dashboard, date(2026, 8, 16)))  # un domingo

    def test_sin_frecuencia_configurada_nunca_corresponde(self):
        dashboard = self._dashboard()  # frecuencia_actualizacion='' por defecto
        self.assertFalse(fuente_bd_scheduler.debe_actualizarse_hoy(dashboard, date(2026, 8, 16)))

    def test_semanal_corresponde_los_domingos(self):
        dashboard = self._dashboard(frecuencia_actualizacion='semanal', configurado_el=date(2026, 8, 10))
        self.assertTrue(fuente_bd_scheduler.debe_actualizarse_hoy(dashboard, date(2026, 8, 16)))  # domingo

    def test_semanal_al_dia_no_corresponde_entre_semana(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='semanal', configurado_el=date(2026, 8, 10),
            ultima_corrida=date(2026, 8, 16),  # el domingo sí corrió
        )
        for dia in range(17, 23):  # lunes 17 a sábado 22 de agosto de 2026
            with self.subTest(dia=dia):
                self.assertFalse(fuente_bd_scheduler.debe_actualizarse_hoy(dashboard, date(2026, 8, dia)))

    def test_semanal_un_domingo_perdido_se_recupera_cualquier_dia_de_la_semana(self):
        """El caso que motivó el cambio: el domingo 16 el programador no corrió (última corrida, el
        domingo 9). Antes había que esperar al domingo 23 — 13 días de datos viejos, sin reintento y
        sin ningún error. Ahora la primera corrida que ocurra, el día que sea, lo pone al día."""
        dashboard = self._dashboard(
            frecuencia_actualizacion='semanal', configurado_el=date(2026, 8, 3),
            ultima_corrida=date(2026, 8, 9),
        )
        for dia in range(17, 23):  # lunes 17 a sábado 22
            with self.subTest(dia=dia):
                self.assertTrue(fuente_bd_scheduler.debe_actualizarse_hoy(dashboard, date(2026, 8, dia)))

    def test_semanal_no_corre_dos_veces_el_mismo_domingo(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='semanal', configurado_el=date(2026, 8, 10),
            ultima_corrida=date(2026, 8, 16),
        )
        self.assertFalse(fuente_bd_scheduler.debe_actualizarse_hoy(dashboard, date(2026, 8, 16)))

    def test_semanal_recien_configurado_espera_a_su_primer_domingo(self):
        """Sin la fecha de configuración como referencia de respaldo, un dashboard configurado el
        lunes se actualizaría esa misma noche en vez de esperar al domingo."""
        dashboard = self._dashboard(frecuencia_actualizacion='semanal', configurado_el=date(2026, 8, 10))
        self.assertFalse(fuente_bd_scheduler.debe_actualizarse_hoy(dashboard, date(2026, 8, 12)))  # miércoles

    def test_mensual_corresponde_el_mismo_dia_del_mes_que_la_ancla(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='mensual', configurado_el=date(2026, 6, 12),
            ultima_corrida=date(2026, 7, 12),
        )
        self.assertTrue(fuente_bd_scheduler.debe_actualizarse_hoy(dashboard, date(2026, 8, 12)))

    def test_mensual_al_dia_no_corresponde_otro_dia_del_mes(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='mensual', configurado_el=date(2026, 6, 12),
            ultima_corrida=date(2026, 8, 12),
        )
        self.assertFalse(fuente_bd_scheduler.debe_actualizarse_hoy(dashboard, date(2026, 8, 13)))

    def test_mensual_un_mes_perdido_se_recupera_despues(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='mensual', configurado_el=date(2026, 6, 12),
            ultima_corrida=date(2026, 7, 12),  # el 12 de agosto no corrió
        )
        self.assertTrue(fuente_bd_scheduler.debe_actualizarse_hoy(dashboard, date(2026, 8, 25)))

    def test_mensual_con_ancla_dia_31_se_recorta_al_ultimo_dia_de_un_mes_mas_corto(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='mensual', configurado_el=date(2026, 1, 31),
            ultima_corrida=date(2026, 1, 31),
        )
        self.assertTrue(fuente_bd_scheduler.debe_actualizarse_hoy(dashboard, date(2026, 2, 28)))  # 2026 no es bisiesto

    def test_mensual_no_corre_dos_veces_el_mismo_mes(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='mensual', configurado_el=date(2026, 6, 12),
            ultima_corrida=date(2026, 8, 12),
        )
        self.assertFalse(fuente_bd_scheduler.debe_actualizarse_hoy(dashboard, date(2026, 8, 12)))


class PeriodosPendientesTests(_ConFuenteBD):
    """Cuántos períodos se perdieron, no solo si se perdió alguno: la fecha de corte de la consulta
    avanza un período por ejecución, así que una corrida de recuperación tiene que avanzarla tantas
    veces como fechas previstas pasaron. Avanzando una sola, el dashboard se pondría al día en la
    ejecución pero nunca en los datos."""

    def test_al_dia_no_hay_nada_pendiente(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='semanal', configurado_el=date(2026, 8, 3),
            ultima_corrida=date(2026, 8, 16),
        )
        self.assertEqual(fuente_bd_scheduler.periodos_pendientes(dashboard, date(2026, 8, 19)), 0)

    def test_semanal_cuenta_cada_domingo_perdido(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='semanal', configurado_el=date(2026, 8, 3),
            ultima_corrida=date(2026, 8, 9),
        )
        # Domingos 16 y 23 sin correr.
        self.assertEqual(fuente_bd_scheduler.periodos_pendientes(dashboard, date(2026, 8, 25)), 2)

    def test_semanal_desde_una_corrida_de_recuperacion_entre_semana(self):
        """Una corrida de recuperación deja la última fecha en un día cualquiera, no en domingo: el
        conteo sigue siendo por domingos pasados, no por semanas exactas desde esa fecha."""
        dashboard = self._dashboard(
            frecuencia_actualizacion='semanal', configurado_el=date(2026, 8, 3),
            ultima_corrida=date(2026, 8, 12),  # miércoles
        )
        self.assertEqual(fuente_bd_scheduler.periodos_pendientes(dashboard, date(2026, 8, 25)), 2)  # 16 y 23

    def test_mensual_cuenta_cada_mes_perdido(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='mensual', configurado_el=date(2026, 5, 12),
            ultima_corrida=date(2026, 6, 12),
        )
        # Julio y agosto sin correr.
        self.assertEqual(fuente_bd_scheduler.periodos_pendientes(dashboard, date(2026, 8, 20)), 2)

    def test_sin_frecuencia_no_hay_periodos_pendientes(self):
        self.assertEqual(fuente_bd_scheduler.periodos_pendientes(self._dashboard(), date(2026, 8, 20)), 0)


class ProximaActualizacionTests(_ConFuenteBD):
    def test_sin_fuente_configurada_devuelve_none(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        self.assertIsNone(fuente_bd_scheduler.proxima_actualizacion(dashboard, date(2026, 8, 13)))

    def test_sin_frecuencia_configurada_devuelve_none(self):
        dashboard = self._dashboard()
        self.assertIsNone(fuente_bd_scheduler.proxima_actualizacion(dashboard, date(2026, 8, 13)))

    def test_semanal_un_jueves_devuelve_el_domingo_siguiente(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='semanal', configurado_el=date(2026, 8, 3),
            ultima_corrida=date(2026, 8, 9),
        )
        self.assertEqual(fuente_bd_scheduler.proxima_actualizacion(dashboard, date(2026, 8, 13)), date(2026, 8, 16))

    def test_semanal_un_domingo_sin_correr_todavia_devuelve_hoy_mismo(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='semanal', configurado_el=date(2026, 8, 3),
            ultima_corrida=date(2026, 8, 9),
        )
        self.assertEqual(fuente_bd_scheduler.proxima_actualizacion(dashboard, date(2026, 8, 16)), date(2026, 8, 16))

    def test_semanal_un_domingo_que_ya_corrio_devuelve_el_proximo_domingo(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='semanal', configurado_el=date(2026, 8, 3),
            ultima_corrida=date(2026, 8, 16),
        )
        self.assertEqual(fuente_bd_scheduler.proxima_actualizacion(dashboard, date(2026, 8, 16)), date(2026, 8, 23))

    def test_atrasado_devuelve_hoy_en_vez_de_la_proxima_fecha_del_calendario(self):
        """La pantalla y el comando tienen que decir lo mismo: si quedó pendiente, la próxima
        corrida lo actualiza — mostrar "el domingo que viene" contradiría al comando, que ya piensa
        actualizarlo esta misma noche."""
        dashboard = self._dashboard(
            frecuencia_actualizacion='semanal', configurado_el=date(2026, 8, 3),
            ultima_corrida=date(2026, 8, 9),  # se perdió el domingo 16
        )
        self.assertEqual(fuente_bd_scheduler.proxima_actualizacion(dashboard, date(2026, 8, 19)), date(2026, 8, 19))

    def test_mensual_antes_del_dia_ancla_devuelve_ese_dia_este_mes(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='mensual', configurado_el=date(2026, 6, 20),
            ultima_corrida=date(2026, 7, 20),
        )
        self.assertEqual(fuente_bd_scheduler.proxima_actualizacion(dashboard, date(2026, 8, 13)), date(2026, 8, 20))

    def test_mensual_despues_del_dia_ancla_devuelve_ese_dia_el_mes_siguiente(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='mensual', configurado_el=date(2026, 6, 5),
            ultima_corrida=date(2026, 8, 5),
        )
        self.assertEqual(fuente_bd_scheduler.proxima_actualizacion(dashboard, date(2026, 8, 13)), date(2026, 9, 5))

    def test_mensual_en_diciembre_pasa_al_enero_siguiente(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='mensual', configurado_el=date(2026, 6, 5),
            ultima_corrida=date(2026, 12, 5),
        )
        self.assertEqual(fuente_bd_scheduler.proxima_actualizacion(dashboard, date(2026, 12, 20)), date(2027, 1, 5))

    def test_mensual_el_mismo_dia_ya_corrido_pasa_al_mes_siguiente(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='mensual', configurado_el=date(2026, 6, 13),
            ultima_corrida=date(2026, 8, 13),
        )
        self.assertEqual(fuente_bd_scheduler.proxima_actualizacion(dashboard, date(2026, 8, 13)), date(2026, 9, 13))

    def test_mensual_con_ancla_dia_31_en_un_mes_de_30_dias(self):
        dashboard = self._dashboard(
            frecuencia_actualizacion='mensual', configurado_el=date(2026, 1, 31),
            ultima_corrida=date(2026, 3, 31),
        )
        self.assertEqual(fuente_bd_scheduler.proxima_actualizacion(dashboard, date(2026, 4, 1)), date(2026, 4, 30))


class AvanzarFechaCorteTests(TestCase):
    def test_semanal_suma_7_dias(self):
        resultado = fuente_bd_scheduler.avanzar_fecha_corte({'FechaCorte': '2026-07-31'}, Dashboard.FuenteBDFrecuencia.SEMANAL)
        self.assertEqual(resultado['FechaCorte'], '2026-08-07')

    def test_mensual_suma_un_mes_calendario(self):
        resultado = fuente_bd_scheduler.avanzar_fecha_corte({'FechaCorte': '2026-07-31'}, Dashboard.FuenteBDFrecuencia.MENSUAL)
        self.assertEqual(resultado['FechaCorte'], '2026-08-31')

    def test_no_toca_otros_parametros(self):
        resultado = fuente_bd_scheduler.avanzar_fecha_corte(
            {'FechaCorte': '2026-07-31', 'Zona': 'Norte'}, Dashboard.FuenteBDFrecuencia.SEMANAL,
        )
        self.assertEqual(resultado['Zona'], 'Norte')

    def test_sin_parametro_fechacorte_no_hace_nada(self):
        resultado = fuente_bd_scheduler.avanzar_fecha_corte({'Zona': 'Norte'}, Dashboard.FuenteBDFrecuencia.SEMANAL)
        self.assertEqual(resultado, {'Zona': 'Norte'})

    def test_fechacorte_no_parseable_se_deja_igual(self):
        resultado = fuente_bd_scheduler.avanzar_fecha_corte({'FechaCorte': 'no-es-una-fecha'}, Dashboard.FuenteBDFrecuencia.SEMANAL)
        self.assertEqual(resultado['FechaCorte'], 'no-es-una-fecha')

    def test_avanza_un_parametro_con_nombre_personalizado(self):
        """El nombre del parámetro es configurable (no siempre "FechaCorte") — se avanza
        cualquiera sea el nombre de la única entrada del dict, tomándolo dinámicamente."""
        resultado = fuente_bd_scheduler.avanzar_fecha_corte({'Fecha': '2026-07-31'}, Dashboard.FuenteBDFrecuencia.SEMANAL)
        self.assertEqual(resultado, {'Fecha': '2026-08-07'})

    def test_sin_parametros_no_hace_nada(self):
        self.assertEqual(fuente_bd_scheduler.avanzar_fecha_corte({}, Dashboard.FuenteBDFrecuencia.SEMANAL), {})
        self.assertEqual(fuente_bd_scheduler.avanzar_fecha_corte(None, Dashboard.FuenteBDFrecuencia.SEMANAL), {})

    def test_semanal_con_varios_periodos_suma_todas_las_semanas(self):
        """Una corrida de recuperación trae el período ACTUAL, no el que quedó pendiente hace
        semanas: si avanzara una sola semana, el dashboard se pondría al día en la ejecución pero
        arrastraría el atraso en los datos para siempre."""
        resultado = fuente_bd_scheduler.avanzar_fecha_corte(
            {'FechaCorte': '2026-07-31'}, Dashboard.FuenteBDFrecuencia.SEMANAL, periodos=3,
        )
        self.assertEqual(resultado['FechaCorte'], '2026-08-21')

    def test_mensual_con_varios_periodos_suma_todos_los_meses(self):
        resultado = fuente_bd_scheduler.avanzar_fecha_corte(
            {'FechaCorte': '2026-05-31'}, Dashboard.FuenteBDFrecuencia.MENSUAL, periodos=3,
        )
        self.assertEqual(resultado['FechaCorte'], '2026-08-31')

    def test_periodos_invalidos_avanzan_uno_solo(self):
        # 0, None o negativo no deben dejar la fecha quieta: eso traería los mismos datos de nuevo.
        for periodos in (0, None, -2):
            with self.subTest(periodos=periodos):
                resultado = fuente_bd_scheduler.avanzar_fecha_corte(
                    {'FechaCorte': '2026-07-31'}, Dashboard.FuenteBDFrecuencia.SEMANAL, periodos=periodos,
                )
                self.assertEqual(resultado['FechaCorte'], '2026-08-07')


class ActualizarDashboardTests(TestCase):
    def _dashboard_con_mapeo_confirmado(self, frecuencia='semanal'):
        import pandas as pd
        from apps.cartera.services import plantilla

        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_Reporte',
            parametros={'FechaCorte': '2026-07-31'}, frecuencia_actualizacion=frecuencia,
        )
        df = pd.DataFrame({'Saldo': [100.0, 200.0], 'Zona': ['Norte', 'Sur']})
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'Saldo'}}
        plantilla.aplicar_mapeo(dashboard.dashboard_id, df, mapeo)
        Dashboard.objects.filter(dashboard_id=dashboard.dashboard_id).update(
            fuente_bd_ultimo_mapeo=mapeo, fuente_bd_ultimo_aliases={},
        )
        dashboard.refresh_from_db()
        return dashboard

    @mock.patch('apps.cartera.services.fuente_bd_scheduler.db_source.leer_fuente')
    def test_la_carga_guarda_la_fecha_de_corte_con_la_que_se_leyo(self, leer_fuente_mock):
        """La fecha de corte de una fuente de base es su parámetro, no una columna del resultado.

        Sin grabarla en la carga, todo lo que la usa —antigüedad por tramos, cumplimiento de metas,
        el "Corte <mes>" del Dashboard Directorio— se calculaba contra la fecha de HOY, que no es la
        fecha de los datos: una actualización del corte al 7 de agosto mostraba la mora al día de la
        corrida.
        """
        import pandas as pd
        from apps.cartera.models import CargaArchivo
        dashboard = self._dashboard_con_mapeo_confirmado()
        leer_fuente_mock.return_value = pd.DataFrame({'Saldo': [500.0], 'Zona': ['Norte']})

        fuente_bd_scheduler.actualizar_dashboard(dashboard, hoy=date(2026, 8, 16))

        carga = CargaArchivo.objects.filter(dashboard_id=dashboard.dashboard_id).latest('fecha_carga')
        self.assertEqual(carga.fecha_corte, date(2026, 8, 7))

    def test_sin_mapeo_confirmado_previamente_no_hace_nada(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x', frecuencia_actualizacion='semanal',
        )
        resultado = fuente_bd_scheduler.actualizar_dashboard(dashboard)
        self.assertFalse(resultado['ok'])

    @mock.patch('apps.cartera.services.fuente_bd_scheduler.db_source.leer_fuente')
    def test_actualiza_el_layout_avanza_fechacorte_y_registra_la_fecha(self, leer_fuente_mock):
        import pandas as pd
        dashboard = self._dashboard_con_mapeo_confirmado()
        leer_fuente_mock.return_value = pd.DataFrame({'Saldo': [500.0, 600.0], 'Zona': ['Norte', 'Sur']})

        resultado = fuente_bd_scheduler.actualizar_dashboard(dashboard, hoy=date(2026, 8, 16))

        self.assertTrue(resultado['ok'])
        leer_fuente_mock.assert_called_once_with(
            'procedimiento', 'dbo.rpt_Reporte', {'FechaCorte': '2026-08-07'}, fecha_formato='YYYY-MM-DD',
        )
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_parametros, {'FechaCorte': '2026-08-07'})
        self.assertEqual(dashboard.fuente_bd_ultima_actualizacion_automatica, date(2026, 8, 16))

        from apps.cartera.models import DashboardComponent
        kpi_1 = DashboardComponent.objects.get(layout__dashboard_id=dashboard.dashboard_id, component_id='kpi-1')
        self.assertEqual(kpi_1.content['valor'], 1100.0)  # 500 + 600, no el 300 anterior

    @mock.patch('apps.cartera.services.fuente_bd_scheduler.db_source.leer_fuente')
    def test_actualiza_y_avanza_un_parametro_con_nombre_personalizado(self, leer_fuente_mock):
        import pandas as pd
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_Reporte',
            parametros={'Fecha': '2026-07-31'}, frecuencia_actualizacion='semanal',
        )
        from apps.cartera.services import plantilla
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'Saldo'}}
        plantilla.aplicar_mapeo(dashboard.dashboard_id, pd.DataFrame({'Saldo': [1.0]}), mapeo)
        Dashboard.objects.filter(dashboard_id=dashboard.dashboard_id).update(
            fuente_bd_ultimo_mapeo=mapeo, fuente_bd_ultimo_aliases={},
        )
        dashboard.refresh_from_db()
        leer_fuente_mock.return_value = pd.DataFrame({'Saldo': [500.0]})

        resultado = fuente_bd_scheduler.actualizar_dashboard(dashboard, hoy=date(2026, 8, 16))

        self.assertTrue(resultado['ok'], resultado['mensaje'])
        leer_fuente_mock.assert_called_once_with(
            'procedimiento', 'dbo.rpt_Reporte', {'Fecha': '2026-08-07'}, fecha_formato='YYYY-MM-DD',
        )
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_parametros, {'Fecha': '2026-08-07'})

    @mock.patch('apps.cartera.services.fuente_bd_scheduler.db_source.leer_fuente')
    def test_una_corrida_de_recuperacion_avanza_la_fecha_de_corte_de_todos_los_periodos_perdidos(self, leer_fuente_mock):
        """Se perdieron dos domingos (el 16 y el 23): la corrida del 25 tiene que consultar por el
        corte vigente, no por el que correspondía dos semanas atrás. Si avanzara una sola semana, el
        dashboard volvería a la rutina pero con los datos permanentemente atrasados."""
        import pandas as pd
        dashboard = self._dashboard_con_mapeo_confirmado()
        Dashboard.objects.filter(dashboard_id=dashboard.dashboard_id).update(
            fuente_bd_fecha_configuracion=date(2026, 8, 3),
            fuente_bd_ultima_actualizacion_automatica=date(2026, 8, 9),
        )
        dashboard.refresh_from_db()
        leer_fuente_mock.return_value = pd.DataFrame({'Saldo': [500.0], 'Zona': ['Norte']})

        resultado = fuente_bd_scheduler.actualizar_dashboard(dashboard, hoy=date(2026, 8, 25))

        self.assertTrue(resultado['ok'], resultado['mensaje'])
        # 31/07 + 2 semanas, no + 1.
        leer_fuente_mock.assert_called_once_with(
            'procedimiento', 'dbo.rpt_Reporte', {'FechaCorte': '2026-08-14'}, fecha_formato='YYYY-MM-DD',
        )
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_parametros, {'FechaCorte': '2026-08-14'})

    @mock.patch('apps.cartera.services.fuente_bd_scheduler.db_source.leer_fuente')
    def test_reaplica_los_aliases_guardados(self, leer_fuente_mock):
        import pandas as pd
        from apps.cartera.services import plantilla

        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='vista', nombre='dbo.v', frecuencia_actualizacion='semanal',
        )
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'Monto'}}
        plantilla.aplicar_mapeo(dashboard.dashboard_id, pd.DataFrame({'Monto': [10.0]}), mapeo)
        Dashboard.objects.filter(dashboard_id=dashboard.dashboard_id).update(
            fuente_bd_ultimo_mapeo=mapeo, fuente_bd_ultimo_aliases={'Saldo': 'Monto'},
        )
        dashboard.refresh_from_db()
        leer_fuente_mock.return_value = pd.DataFrame({'Saldo': [999.0]})  # vuelve con el nombre ORIGINAL

        resultado = fuente_bd_scheduler.actualizar_dashboard(dashboard)

        self.assertTrue(resultado['ok'], resultado['mensaje'])
        from apps.cartera.models import DashboardComponent
        kpi_1 = DashboardComponent.objects.get(layout__dashboard_id=dashboard.dashboard_id, component_id='kpi-1')
        self.assertEqual(kpi_1.content['valor'], 999.0)

    @mock.patch('apps.cartera.services.fuente_bd_scheduler.db_source.leer_fuente')
    def test_guarda_filas_historicas_segun_la_configuracion_persistente(self, leer_fuente_mock):
        import pandas as pd
        from apps.cartera.services import historico

        dashboard = self._dashboard_con_mapeo_confirmado()
        historico.establecer_columnas_historicas(dashboard.dashboard_id, ['Saldo'])
        leer_fuente_mock.return_value = pd.DataFrame({'Saldo': [500.0, 600.0], 'Zona': ['Norte', 'Sur']})

        fuente_bd_scheduler.actualizar_dashboard(dashboard)

        carga = CargaArchivo.objects.filter(dashboard_id=dashboard.dashboard_id).latest('fecha_carga')
        filas = FilaArchivoHistorico.objects.filter(carga=carga)
        self.assertEqual(filas.count(), 2)

    @mock.patch('apps.cartera.services.fuente_bd_scheduler.db_source.leer_fuente')
    def test_una_falla_de_conexion_no_lanza_y_no_toca_el_layout(self, leer_fuente_mock):
        dashboard = self._dashboard_con_mapeo_confirmado()
        leer_fuente_mock.side_effect = CarteraError('No se pudo conectar.', codigo='FUENTE_BD_CONEXION_FALLIDA')

        resultado = fuente_bd_scheduler.actualizar_dashboard(dashboard)

        self.assertFalse(resultado['ok'])
        self.assertIn('No se pudo conectar', resultado['mensaje'])
        dashboard.refresh_from_db()
        self.assertIsNone(dashboard.fuente_bd_ultima_actualizacion_automatica)

    @mock.patch('apps.cartera.services.fuente_bd_scheduler.db_source.leer_fuente')
    def test_una_columna_del_mapeo_guardado_que_ya_no_viene_no_lanza(self, leer_fuente_mock):
        """Igual criterio que el resto de `services/plantilla.py`: una columna mapeada que dejó de
        existir no revienta la actualización completa, esa posición puntual simplemente no
        recalcula (mismo comportamiento que tendría un usuario editando el mapeo a mano)."""
        import pandas as pd
        dashboard = self._dashboard_con_mapeo_confirmado()
        # La vista/procedimiento cambió de estructura: ya no trae "Saldo".
        leer_fuente_mock.return_value = pd.DataFrame({'OtraColumna': [1, 2]})

        resultado = fuente_bd_scheduler.actualizar_dashboard(dashboard)

        self.assertTrue(resultado['ok'], resultado['mensaje'])

    @mock.patch('apps.cartera.services.fuente_bd_scheduler.db_source.leer_fuente')
    def test_convierte_decimales_correctamente_como_la_conexion_manual(self, leer_fuente_mock):
        import pandas as pd
        dashboard = self._dashboard_con_mapeo_confirmado()
        leer_fuente_mock.return_value = pd.DataFrame({
            'Saldo': [decimal.Decimal('500.00'), decimal.Decimal('600.00')], 'Zona': ['Norte', 'Sur'],
        })

        resultado = fuente_bd_scheduler.actualizar_dashboard(dashboard)
        self.assertTrue(resultado['ok'], resultado['mensaje'])

    @mock.patch('apps.cartera.services.fuente_bd_scheduler.db_source.leer_fuente')
    def test_una_fuente_guardada_que_ya_no_es_valida_no_se_ejecuta(self, leer_fuente_mock):
        """Auditoría de seguridad, 29/10/2026: una fuente guardada antes de las reglas de objetos
        del sistema no se ejecuta sola; queda el motivo en el log y en el resultado."""
        dashboard = self._dashboard_con_mapeo_confirmado()
        Dashboard.objects.filter(dashboard_id=dashboard.dashboard_id).update(fuente_bd_nombre='sp_executesql')
        dashboard.refresh_from_db()

        with self.assertLogs('apps.cartera.services.fuente_bd_scheduler', level='WARNING') as logs:
            resultado = fuente_bd_scheduler.actualizar_dashboard(dashboard)

        self.assertFalse(resultado['ok'])
        self.assertIn('sistema', resultado['mensaje'])
        self.assertIn('sp_executesql', logs.output[0])
        leer_fuente_mock.assert_not_called()

    @mock.patch('apps.cartera.services.fuente_bd_scheduler.db_source.leer_fuente')
    def test_un_parametro_guardado_invalido_no_se_ejecuta(self, leer_fuente_mock):
        dashboard = self._dashboard_con_mapeo_confirmado()
        Dashboard.objects.filter(dashboard_id=dashboard.dashboard_id).update(
            fuente_bd_parametros={'x = 1; DROP TABLE t--': '2026-07-31'},
        )
        dashboard.refresh_from_db()

        with self.assertLogs('apps.cartera.services.fuente_bd_scheduler', level='WARNING'):
            resultado = fuente_bd_scheduler.actualizar_dashboard(dashboard)

        self.assertFalse(resultado['ok'])
        leer_fuente_mock.assert_not_called()


class ActualizarTodosYComandoTests(TestCase):
    @mock.patch('apps.cartera.services.fuente_bd_scheduler.debe_actualizarse_hoy')
    @mock.patch('apps.cartera.services.fuente_bd_scheduler.actualizar_dashboard')
    def test_actualizar_todos_solo_procesa_los_que_corresponden_hoy(self, actualizar_mock, debe_mock):
        d1 = crear_dashboard(nombre='Uno')
        actualizar_fuente_bd(d1.dashboard_id, tipo='vista', nombre='dbo.v1', frecuencia_actualizacion='semanal')
        d2 = crear_dashboard(nombre='Dos')
        actualizar_fuente_bd(d2.dashboard_id, tipo='vista', nombre='dbo.v2', frecuencia_actualizacion='mensual')
        crear_dashboard(nombre='Tres')  # sin fuente configurada, ni entra al filtro inicial

        debe_mock.side_effect = lambda dashboard, hoy: dashboard.dashboard_id == d1.dashboard_id
        actualizar_mock.return_value = {'ok': True, 'mensaje': 'Actualizado con 5 fila(s).'}

        resultados = fuente_bd_scheduler.actualizar_todos(hoy=date(2026, 8, 16))

        self.assertEqual(len(resultados), 1)
        self.assertEqual(resultados[0]['dashboard_id'], d1.dashboard_id)
        actualizar_mock.assert_called_once()

    @mock.patch('apps.cartera.services.fuente_bd_scheduler.actualizar_todos')
    def test_comando_reporta_cuando_no_hay_nada_vencido(self, actualizar_todos_mock):
        actualizar_todos_mock.return_value = []
        from io import StringIO
        salida = StringIO()
        call_command('actualizar_fuentes_bd', stdout=salida)
        self.assertIn('Ningún dashboard', salida.getvalue())

    @mock.patch('apps.cartera.services.fuente_bd_scheduler.actualizar_todos')
    def test_comando_reporta_cada_resultado(self, actualizar_todos_mock):
        actualizar_todos_mock.return_value = [
            {'dashboard_id': 'cobranza', 'ok': True, 'mensaje': 'Actualizado con 10 fila(s).'},
            {'dashboard_id': 'ventas', 'ok': False, 'mensaje': 'No se pudo conectar.'},
        ]
        from io import StringIO
        salida = StringIO()
        call_command('actualizar_fuentes_bd', stdout=salida)
        texto = salida.getvalue()
        self.assertIn('cobranza: Actualizado con 10 fila(s).', texto)
        self.assertIn('ventas: No se pudo conectar.', texto)
