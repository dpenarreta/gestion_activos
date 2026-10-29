"""Conexión externa de solo lectura ("Conectar vista de base de datos"): validación del nombre de
fuente, lectura vía `db_source.leer_fuente` (pyodbc/pandas siempre mockeados — nunca se conecta a
una base real en los tests), configuración por dashboard (`services/dashboards.py`) y los dos
endpoints (`DashboardFuenteBDView`, `ConectarFuenteBDView`)."""

import decimal
from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.cartera.exceptions import CarteraError
from apps.cartera.models import CargaArchivo, Dashboard
from apps.cartera.services import db_source
from apps.cartera.services.dashboards import actualizar_fuente_bd, crear_dashboard, obtener_fuente_bd

User = get_user_model()


class ValidarNombreFuenteTests(TestCase):
    def test_acepta_un_nombre_simple(self):
        db_source.validar_nombre_fuente('mi_vista')  # no lanza

    def test_acepta_esquema_punto_objeto(self):
        db_source.validar_nombre_fuente('dbo.rpt_Reporte_Seguimiento_Cartera')  # no lanza

    def test_rechaza_vacio(self):
        with self.assertRaises(CarteraError) as ctx:
            db_source.validar_nombre_fuente('')
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_NOMBRE_INVALIDO')

    def test_rechaza_punto_y_coma(self):
        with self.assertRaises(CarteraError) as ctx:
            db_source.validar_nombre_fuente('vista; DROP TABLE x--')
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_NOMBRE_INVALIDO')

    def test_rechaza_espacios(self):
        with self.assertRaises(CarteraError):
            db_source.validar_nombre_fuente('mi vista')

    def test_rechaza_mas_de_un_punto(self):
        with self.assertRaises(CarteraError):
            db_source.validar_nombre_fuente('base.dbo.vista')


class ObjetosDeSistemaYListaBlancaTests(TestCase):
    """Auditoría de seguridad, 29/10/2026: la regex de identificador no alcanzaba — dejaba
    ejecutar `sp_executesql`, `xp_cmdshell` o leer `sys.sql_logins` en la base externa."""

    def _codigo(self, nombre):
        with self.assertRaises(CarteraError) as ctx:
            db_source.validar_nombre_fuente(nombre)
        return ctx.exception.codigo

    def test_rechaza_procedimientos_y_vistas_del_sistema(self):
        for nombre in (
            'sp_executesql', 'dbo.sp_executesql', 'sys.sp_executesql', 'xp_cmdshell',
            'dbo.xp_cmdshell', 'sys.sql_logins', 'SYS.objects', 'INFORMATION_SCHEMA.TABLES',
            'master.sysobjects', 'msdb.backupset', 'tempdb.x', 'model.x', 'fn_my_permissions',
            'dbo.dt_addtosourcecontrol',
        ):
            with self.subTest(nombre=nombre):
                self.assertIn(self._codigo(nombre), {'FUENTE_BD_OBJETO_DE_SISTEMA', 'FUENTE_BD_OBJETO_NO_PERMITIDO'})

    def test_rechaza_nombres_de_tres_partes(self):
        self.assertEqual(self._codigo('otra_base.dbo.x'), 'FUENTE_BD_NOMBRE_INVALIDO')

    def test_rechaza_salto_de_linea_al_final(self):
        self.assertEqual(self._codigo('mi_vista\n'), 'FUENTE_BD_NOMBRE_INVALIDO')

    def test_acepta_una_vista_normal(self):
        db_source.validar_nombre_fuente('dbo.vw_cartera_vencida')  # no lanza
        db_source.validar_nombre_fuente('reportes.vw_cartera')  # no lanza

    def test_un_procedimiento_sp_propio_sin_lista_blanca_se_rechaza(self):
        self.assertEqual(self._codigo('dbo.sp_Reporte_Seguimiento_Cartera'), 'FUENTE_BD_OBJETO_NO_PERMITIDO')

    @override_settings(EXTERNAL_DB_OBJETOS_PERMITIDOS=['dbo.sp_Reporte_Seguimiento_Cartera'])
    def test_un_procedimiento_sp_propio_en_la_lista_blanca_se_acepta(self):
        db_source.validar_nombre_fuente('dbo.sp_Reporte_Seguimiento_Cartera')  # no lanza
        # Sin mayúsculas y con o sin «dbo.».
        db_source.validar_nombre_fuente('SP_REPORTE_SEGUIMIENTO_CARTERA')  # no lanza

    @override_settings(EXTERNAL_DB_OBJETOS_PERMITIDOS=['sp_executesql', 'xp_cmdshell', 'sys.sql_logins'])
    def test_la_lista_blanca_no_habilita_objetos_del_sistema(self):
        for nombre in ('sp_executesql', 'xp_cmdshell', 'sys.sql_logins'):
            with self.subTest(nombre=nombre):
                self.assertEqual(self._codigo(nombre), 'FUENTE_BD_OBJETO_DE_SISTEMA')

    @override_settings(EXTERNAL_DB_OBJETOS_PERMITIDOS=['vw_cartera', 'reportes.vw_otra'])
    def test_con_lista_blanca_solo_se_acepta_lo_que_esta(self):
        db_source.validar_nombre_fuente('dbo.vw_cartera')  # no lanza
        db_source.validar_nombre_fuente('VW_CARTERA')  # no lanza
        db_source.validar_nombre_fuente('reportes.vw_otra')  # no lanza
        self.assertEqual(self._codigo('dbo.vw_no_listada'), 'FUENTE_BD_OBJETO_NO_PERMITIDO')
        # Otro esquema no es el mismo objeto.
        self.assertEqual(self._codigo('reportes.vw_cartera'), 'FUENTE_BD_OBJETO_NO_PERMITIDO')

    @override_settings(EXTERNAL_DB_OBJETOS_PERMITIDOS=[])
    def test_lista_blanca_vacia_aplica_solo_las_reglas_fijas(self):
        db_source.validar_nombre_fuente('dbo.cualquier_vista')  # no lanza
        self.assertEqual(self._codigo('xp_cmdshell'), 'FUENTE_BD_OBJETO_DE_SISTEMA')

    @mock.patch('apps.cartera.services.db_source.pyodbc.connect')
    def test_leer_fuente_no_conecta_si_el_objeto_es_del_sistema(self, connect_mock):
        with self.assertRaises(CarteraError):
            db_source.leer_fuente('procedimiento', 'sp_executesql', {'stmt': 'SELECT 1'})
        connect_mock.assert_not_called()

    def test_configurar_un_dashboard_con_objeto_del_sistema_se_rechaza(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        with self.assertRaises(CarteraError) as ctx:
            actualizar_fuente_bd(dashboard.dashboard_id, tipo='procedimiento', nombre='xp_cmdshell')
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_OBJETO_DE_SISTEMA')
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_nombre, '')


class CadenaDeConexionTests(TestCase):
    """Auditoría de seguridad, 29/10/2026: cada valor va entre llaves y con `}` escrita `}}`, así
    un `;` en la contraseña no agrega atributos a la conexión."""

    @override_settings(
        DB_ODBC_DRIVER='ODBC Driver 17 for SQL Server', EXTERNAL_DB_HOST='10.0.0.5', EXTERNAL_DB_PORT='1433',
        EXTERNAL_DB_NAME='Origen', EXTERNAL_DB_USER='lector', EXTERNAL_DB_PASSWORD='a;Trusted_Connection=yes}x',
        EXTERNAL_DB_ENCRYPT='yes', EXTERNAL_DB_TRUST_SERVER_CERTIFICATE='no',
    )
    def test_envuelve_y_escapa_cada_valor(self):
        self.assertEqual(
            db_source.cadena_de_conexion(),
            'DRIVER={ODBC Driver 17 for SQL Server};SERVER={10.0.0.5,1433};DATABASE={Origen};'
            'UID={lector};PWD={a;Trusted_Connection=yes}}x};Encrypt={yes};TrustServerCertificate={no};',
        )

    def test_valor_odbc(self):
        self.assertEqual(db_source._valor_odbc('abc'), '{abc}')
        self.assertEqual(db_source._valor_odbc('a}b'), '{a}}b}')
        self.assertEqual(db_source._valor_odbc(''), '{}')


class ValidarNombreParametroTests(TestCase):
    def test_acepta_un_nombre_simple(self):
        db_source.validar_nombre_parametro('FechaCorte')  # no lanza

    def test_rechaza_vacio(self):
        with self.assertRaises(CarteraError) as ctx:
            db_source.validar_nombre_parametro('')
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_PARAMETRO_INVALIDO')

    def test_rechaza_arroba(self):
        with self.assertRaises(CarteraError) as ctx:
            db_source.validar_nombre_parametro('@FechaCorte')
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_PARAMETRO_INVALIDO')

    def test_rechaza_espacios(self):
        with self.assertRaises(CarteraError):
            db_source.validar_nombre_parametro('Fecha Corte')


# Conexión externa ficticia, aplicada a toda clase que ejercite `leer_fuente`. Dos motivos para
# tenerla acá y no escrita a mano en cada clase:
#
# 1. Sin `EXTERNAL_DB_HOST` configurado, `db_source._conectar` corta antes de llegar al `pyodbc`
#    mockeado y lanza `FUENTE_BD_NO_CONFIGURADA_APP`. Las pruebas de conexión que quedaron fuera
#    de este override pasaban solo porque el `.env` de quien las escribió tenía un host real: en
#    CI, donde no hay `.env`, fallaban.
# 2. Los valores son deliberadamente ficticios. Antes eran el host, la base y el usuario reales de
#    la red interna, lo que en un repositorio público expone detalles de infraestructura sin
#    ninguna necesidad — una prueba con `pyodbc` mockeado nunca conecta a ningún lado.
CONEXION_EXTERNA_DE_PRUEBA = dict(
    EXTERNAL_DB_HOST='db-externa.ejemplo.local', EXTERNAL_DB_PORT='1433',
    EXTERNAL_DB_NAME='base_de_prueba', EXTERNAL_DB_USER='usuario_de_prueba',
    EXTERNAL_DB_PASSWORD='clave-de-prueba', EXTERNAL_DB_ENCRYPT='no',
    EXTERNAL_DB_TRUST_SERVER_CERTIFICATE='yes',
)


@override_settings(**CONEXION_EXTERNA_DE_PRUEBA)
class LeerFuenteServiceTests(TestCase):
    @mock.patch('apps.cartera.services.db_source.pd.read_sql')
    @mock.patch('apps.cartera.services.db_source.pyodbc.connect')
    def test_tipo_vista_arma_un_select(self, connect_mock, read_sql_mock):
        import pandas as pd
        read_sql_mock.return_value = pd.DataFrame({'Saldo': [1.0, 2.0]})

        db_source.leer_fuente('vista', 'dbo.mi_vista')

        consulta = read_sql_mock.call_args[0][0]
        self.assertEqual(consulta, 'SELECT * FROM dbo.mi_vista')

    @mock.patch('apps.cartera.services.db_source.pd.read_sql')
    @mock.patch('apps.cartera.services.db_source.pyodbc.connect')
    def test_tipo_procedimiento_arma_un_exec(self, connect_mock, read_sql_mock):
        import pandas as pd
        read_sql_mock.return_value = pd.DataFrame({'Saldo': [1.0, 2.0]})

        db_source.leer_fuente('procedimiento', 'dbo.rpt_Reporte_Seguimiento_Cartera')

        consulta = read_sql_mock.call_args[0][0]
        self.assertEqual(consulta, 'EXEC dbo.rpt_Reporte_Seguimiento_Cartera')

    @mock.patch('apps.cartera.services.db_source.pd.read_sql')
    @mock.patch('apps.cartera.services.db_source.pyodbc.connect')
    def test_tipo_procedimiento_con_parametros_los_bindea_en_vez_de_interpolarlos(self, connect_mock, read_sql_mock):
        import pandas as pd
        read_sql_mock.return_value = pd.DataFrame({'Saldo': [1.0, 2.0]})

        db_source.leer_fuente('procedimiento', 'dbo.rpt_Reporte_Seguimiento_Cartera', {'FechaCorte': '2026-07-31'})

        args, kwargs = read_sql_mock.call_args
        self.assertEqual(args[0], 'EXEC dbo.rpt_Reporte_Seguimiento_Cartera @FechaCorte = ?')
        self.assertEqual(kwargs['params'], ['2026-07-31'])

    @mock.patch('apps.cartera.services.db_source.pd.read_sql')
    @mock.patch('apps.cartera.services.db_source.pyodbc.connect')
    def test_tipo_vista_ignora_parametros(self, connect_mock, read_sql_mock):
        import pandas as pd
        read_sql_mock.return_value = pd.DataFrame({'Saldo': [1.0, 2.0]})

        db_source.leer_fuente('vista', 'dbo.mi_vista', {'FechaCorte': '2026-07-31'})

        consulta = read_sql_mock.call_args[0][0]
        self.assertEqual(consulta, 'SELECT * FROM dbo.mi_vista')

    @mock.patch('apps.cartera.services.db_source.pd.read_sql')
    @mock.patch('apps.cartera.services.db_source.pyodbc.connect')
    def test_varios_parametros_se_arman_en_orden_del_diccionario(self, connect_mock, read_sql_mock):
        import pandas as pd
        read_sql_mock.return_value = pd.DataFrame({'Saldo': [1.0]})

        db_source.leer_fuente('procedimiento', 'dbo.rpt_x', {'A': '1', 'B': '2'})

        args, kwargs = read_sql_mock.call_args
        self.assertEqual(args[0], 'EXEC dbo.rpt_x @A = ?, @B = ?')
        self.assertEqual(kwargs['params'], ['1', '2'])

    def test_nombre_de_parametro_invalido_lanza_error_de_negocio(self):
        with self.assertRaises(CarteraError) as ctx:
            db_source.leer_fuente('procedimiento', 'dbo.rpt_x', {'A; DROP TABLE x--': '1'})
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_PARAMETRO_INVALIDO')

    @mock.patch('apps.cartera.services.db_source.pd.read_sql')
    @mock.patch('apps.cartera.services.db_source.pyodbc.connect')
    def test_sin_fecha_formato_bindea_fechacorte_tal_cual_iso(self, connect_mock, read_sql_mock):
        import pandas as pd
        read_sql_mock.return_value = pd.DataFrame({'Saldo': [1.0]})

        db_source.leer_fuente('procedimiento', 'dbo.rpt_x', {'FechaCorte': '2026-07-31'})

        self.assertEqual(read_sql_mock.call_args.kwargs['params'], ['2026-07-31'])

    @mock.patch('apps.cartera.services.db_source.pd.read_sql')
    @mock.patch('apps.cartera.services.db_source.pyodbc.connect')
    def test_fecha_formato_dia_mes_anio_reescribe_el_valor_de_fechacorte(self, connect_mock, read_sql_mock):
        import pandas as pd
        read_sql_mock.return_value = pd.DataFrame({'Saldo': [1.0]})

        db_source.leer_fuente('procedimiento', 'dbo.rpt_x', {'FechaCorte': '2026-07-31'}, fecha_formato='DD/MM/YYYY')

        self.assertEqual(read_sql_mock.call_args.kwargs['params'], ['31/07/2026'])

    @mock.patch('apps.cartera.services.db_source.pd.read_sql')
    @mock.patch('apps.cartera.services.db_source.pyodbc.connect')
    def test_fecha_formato_no_toca_otros_parametros_que_no_sean_fechacorte(self, connect_mock, read_sql_mock):
        import pandas as pd
        read_sql_mock.return_value = pd.DataFrame({'Saldo': [1.0]})

        db_source.leer_fuente(
            'procedimiento', 'dbo.rpt_x', {'FechaCorte': '2026-07-31', 'Zona': 'Norte'}, fecha_formato='DD/MM/YYYY',
        )

        self.assertEqual(read_sql_mock.call_args.kwargs['params'], ['31/07/2026', 'Norte'])

    @mock.patch('apps.cartera.services.db_source.pd.read_sql')
    @mock.patch('apps.cartera.services.db_source.pyodbc.connect')
    def test_fecha_formato_se_aplica_aunque_el_parametro_no_se_llame_fechacorte(self, connect_mock, read_sql_mock):
        """El nombre del parámetro es configurable (`ConectarFuenteBDModal.jsx`, "Nombre del
        parámetro") — `leer_fuente` no debe asumir el nombre literal "FechaCorte" para decidir si
        reformatea, aplica el formato al único valor que reciba, sea cual sea su nombre."""
        import pandas as pd
        read_sql_mock.return_value = pd.DataFrame({'Saldo': [1.0]})

        db_source.leer_fuente('procedimiento', 'dbo.rpt_x', {'Fecha': '2026-07-31'}, fecha_formato='DD/MM/YYYY')

        args, kwargs = read_sql_mock.call_args
        self.assertEqual(args[0], 'EXEC dbo.rpt_x @Fecha = ?')
        self.assertEqual(kwargs['params'], ['31/07/2026'])


@override_settings(**CONEXION_EXTERNA_DE_PRUEBA)
class FormatearValorFechaCorteServiceTests(TestCase):
    def test_iso_devuelve_el_mismo_valor(self):
        self.assertEqual(db_source.formatear_valor_fecha_corte('2026-07-31', 'YYYY-MM-DD'), '2026-07-31')

    def test_dia_mes_anio(self):
        self.assertEqual(db_source.formatear_valor_fecha_corte('2026-07-31', 'DD/MM/YYYY'), '31/07/2026')

    def test_mes_dia_anio(self):
        self.assertEqual(db_source.formatear_valor_fecha_corte('2026-07-31', 'MM/DD/YYYY'), '07/31/2026')

    def test_iso_con_hora_agrega_medianoche(self):
        self.assertEqual(
            db_source.formatear_valor_fecha_corte('2026-07-31', 'YYYY-MM-DD HH:mm:ss'), '2026-07-31 00:00:00',
        )

    def test_sin_formato_devuelve_el_valor_tal_cual(self):
        self.assertEqual(db_source.formatear_valor_fecha_corte('2026-07-31', None), '2026-07-31')
        self.assertEqual(db_source.formatear_valor_fecha_corte('2026-07-31', ''), '2026-07-31')

    def test_formato_desconocido_devuelve_el_valor_tal_cual(self):
        self.assertEqual(db_source.formatear_valor_fecha_corte('2026-07-31', 'ALGO_INVENTADO'), '2026-07-31')

    def test_valor_no_iso_devuelve_el_valor_tal_cual_sin_romper(self):
        self.assertEqual(db_source.formatear_valor_fecha_corte('31/07/2026', 'DD/MM/YYYY'), '31/07/2026')

    def test_valor_vacio_devuelve_el_valor_tal_cual(self):
        self.assertEqual(db_source.formatear_valor_fecha_corte('', 'DD/MM/YYYY'), '')
        self.assertIsNone(db_source.formatear_valor_fecha_corte(None, 'DD/MM/YYYY'))

    @mock.patch('apps.cartera.services.db_source.pd.read_sql')
    @mock.patch('apps.cartera.services.db_source.pyodbc.connect')
    def test_cierra_la_conexion_incluso_si_la_consulta_falla(self, connect_mock, read_sql_mock):
        conexion = mock.Mock()
        connect_mock.return_value = conexion
        read_sql_mock.side_effect = Exception('objeto inexistente')

        with self.assertRaises(CarteraError) as ctx:
            db_source.leer_fuente('vista', 'dbo.no_existe')
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_CONSULTA_FALLIDA')
        conexion.close.assert_called_once()

    @mock.patch('apps.cartera.services.db_source.pyodbc.connect')
    def test_error_de_login_se_traduce_a_error_de_negocio(self, connect_mock):
        import pyodbc
        connect_mock.side_effect = pyodbc.Error('28000', 'login failed')

        with self.assertRaises(CarteraError) as ctx:
            db_source.leer_fuente('vista', 'dbo.mi_vista')
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_CONEXION_FALLIDA')

    @override_settings(EXTERNAL_DB_HOST='')
    def test_sin_host_configurado_lanza_error_de_negocio_propio(self):
        with self.assertRaises(CarteraError) as ctx:
            db_source.leer_fuente('vista', 'dbo.mi_vista')
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_NO_CONFIGURADA_APP')

    @mock.patch('apps.cartera.services.db_source.pd.read_sql')
    @mock.patch('apps.cartera.services.db_source.pyodbc.connect')
    def test_columnas_decimal_se_convierten_a_float(self, connect_mock, read_sql_mock):
        import pandas as pd
        read_sql_mock.return_value = pd.DataFrame({
            'Saldo': [decimal.Decimal('100.50'), decimal.Decimal('200.25'), None],
            'Cliente': ['A', 'B', 'C'],
        })

        df = db_source.leer_fuente('vista', 'dbo.mi_vista')

        self.assertTrue(pd.api.types.is_float_dtype(df['Saldo']))
        self.assertEqual(df['Saldo'].tolist()[0], 100.5)
        self.assertTrue(pd.isna(df['Saldo'].tolist()[2]))

    @mock.patch('apps.cartera.services.db_source.pd.read_sql')
    @mock.patch('apps.cartera.services.db_source.pyodbc.connect')
    def test_sin_columnas_devueltas_lanza_error_de_negocio(self, connect_mock, read_sql_mock):
        import pandas as pd
        read_sql_mock.return_value = pd.DataFrame()

        with self.assertRaises(CarteraError) as ctx:
            db_source.leer_fuente('vista', 'dbo.vacia')
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_SIN_COLUMNAS')


class FechaCorteDeParametrosTests(TestCase):
    """De dónde sale la fecha de corte de una fuente de base."""

    def test_toma_el_parametro_de_fecha(self):
        self.assertEqual(db_source.fecha_corte_de_parametros({'FechaCorte': '2026-07-31'}), date(2026, 7, 31))

    def test_no_asume_el_nombre_del_parametro(self):
        # El nombre lo elige quien configura la conexión ("Nombre del parámetro" en el modal).
        self.assertEqual(db_source.fecha_corte_de_parametros({'Corte': '2026-07-31'}), date(2026, 7, 31))

    def test_sin_parametros_no_hay_fecha(self):
        self.assertIsNone(db_source.fecha_corte_de_parametros({}))
        self.assertIsNone(db_source.fecha_corte_de_parametros(None))

    def test_un_valor_que_no_es_fecha_no_rompe_la_lectura(self):
        # La fecha es informativa para el cálculo; un parámetro que no lo sea (una zona, un código)
        # no puede impedir que la fuente se lea.
        self.assertIsNone(db_source.fecha_corte_de_parametros({'Zona': 'Norte'}))
        self.assertIsNone(db_source.fecha_corte_de_parametros({'FechaCorte': ''}))


class ActualizarFuenteBDServiceTests(TestCase):
    def test_configura_tipo_y_nombre(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        resultado = actualizar_fuente_bd(dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_Reporte')
        self.assertEqual(resultado, {
            'tipo': 'procedimiento', 'nombre': 'dbo.rpt_Reporte', 'parametros': {},
            'fecha_formato': 'YYYY-MM-DD', 'frecuencia_actualizacion': '',
        })
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_tipo, 'procedimiento')
        self.assertEqual(dashboard.fuente_bd_nombre, 'dbo.rpt_Reporte')

    def test_configura_parametros_para_un_procedimiento(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        resultado = actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_Reporte',
            parametros={'FechaCorte': '2026-07-31'},
        )
        self.assertEqual(resultado['parametros'], {'FechaCorte': '2026-07-31'})
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_parametros, {'FechaCorte': '2026-07-31'})

    def test_configura_un_parametro_con_nombre_personalizado(self):
        """El nombre del parámetro (no solo su valor) es configurable — un nombre distinto de
        "FechaCorte" se guarda y se lee tal cual, sin normalizarlo a un nombre fijo."""
        dashboard = crear_dashboard(nombre='Cobranza')
        resultado = actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_Reporte',
            parametros={'Fecha': '2026-07-31'},
        )
        self.assertEqual(resultado['parametros'], {'Fecha': '2026-07-31'})
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_parametros, {'Fecha': '2026-07-31'})

    def test_parametros_se_ignoran_para_tipo_vista(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        resultado = actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='vista', nombre='dbo.v', parametros={'FechaCorte': '2026-07-31'},
        )
        self.assertEqual(resultado['parametros'], {})

    def test_parametro_con_nombre_invalido_es_rechazado(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        with self.assertRaises(CarteraError) as ctx:
            actualizar_fuente_bd(
                dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x',
                parametros={'Fecha Corte': '2026-07-31'},
            )
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_PARAMETRO_INVALIDO')

    def test_reconfigurar_sin_parametros_los_borra(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x', parametros={'FechaCorte': '2026-07-31'},
        )
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x')
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_parametros, {})

    def test_configura_fecha_formato_para_un_procedimiento(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        resultado = actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_Reporte', fecha_formato='DD/MM/YYYY',
        )
        self.assertEqual(resultado['fecha_formato'], 'DD/MM/YYYY')
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_fecha_formato, 'DD/MM/YYYY')

    def test_sin_fecha_formato_elegido_cae_a_iso_por_defecto(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        resultado = actualizar_fuente_bd(dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_Reporte')
        self.assertEqual(resultado['fecha_formato'], 'YYYY-MM-DD')

    def test_fecha_formato_se_ignora_para_tipo_vista(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        resultado = actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='vista', nombre='dbo.v', fecha_formato='DD/MM/YYYY',
        )
        self.assertEqual(resultado['fecha_formato'], 'YYYY-MM-DD')

    def test_fecha_formato_invalido_es_rechazado(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        with self.assertRaises(CarteraError) as ctx:
            actualizar_fuente_bd(
                dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x', fecha_formato='ALGO_INVENTADO',
            )
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_FECHA_FORMATO_INVALIDO')

    def test_tipo_vacio_y_nombre_vacio_desconfigura(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='', nombre='')
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_tipo, '')
        self.assertEqual(dashboard.fuente_bd_nombre, '')

    def test_tipo_sin_nombre_es_rechazado(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        with self.assertRaises(CarteraError) as ctx:
            actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='')
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_INCOMPLETA')

    def test_nombre_sin_tipo_es_rechazado(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        with self.assertRaises(CarteraError) as ctx:
            actualizar_fuente_bd(dashboard.dashboard_id, tipo='', nombre='dbo.v')
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_INCOMPLETA')

    def test_tipo_invalido_es_rechazado(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        with self.assertRaises(CarteraError) as ctx:
            actualizar_fuente_bd(dashboard.dashboard_id, tipo='tabla', nombre='dbo.t')
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_TIPO_INVALIDO')

    def test_nombre_con_caracteres_invalidos_es_rechazado(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        with self.assertRaises(CarteraError) as ctx:
            actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='vista; drop table x')
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_NOMBRE_INVALIDO')

    def test_configura_frecuencia_semanal_y_ancla_la_fecha_de_configuracion_a_hoy(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        resultado = actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x', frecuencia_actualizacion='semanal',
        )
        self.assertEqual(resultado['frecuencia_actualizacion'], 'semanal')
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_frecuencia_actualizacion, 'semanal')
        self.assertEqual(dashboard.fuente_bd_fecha_configuracion, timezone.now().date())

    def test_reconectar_sin_cambiar_la_frecuencia_no_mueve_la_ancla(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x', frecuencia_actualizacion='mensual',
        )
        dashboard.refresh_from_db()
        ancla_original = dashboard.fuente_bd_fecha_configuracion
        Dashboard.objects.filter(dashboard_id=dashboard.dashboard_id).update(
            fuente_bd_fecha_configuracion=ancla_original - timezone.timedelta(days=10),
        )

        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x', frecuencia_actualizacion='mensual',
        )

        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_fecha_configuracion, ancla_original - timezone.timedelta(days=10))

    def test_cambiar_de_semanal_a_mensual_mueve_la_ancla_a_hoy(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x', frecuencia_actualizacion='semanal',
        )
        Dashboard.objects.filter(dashboard_id=dashboard.dashboard_id).update(
            fuente_bd_fecha_configuracion=timezone.now().date() - timezone.timedelta(days=30),
        )

        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x', frecuencia_actualizacion='mensual',
        )

        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_fecha_configuracion, timezone.now().date())

    def test_desactivar_la_frecuencia_borra_la_ancla(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x', frecuencia_actualizacion='semanal',
        )
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x', frecuencia_actualizacion='')
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_frecuencia_actualizacion, '')
        self.assertIsNone(dashboard.fuente_bd_fecha_configuracion)

    def test_frecuencia_invalida_es_rechazada(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        with self.assertRaises(CarteraError) as ctx:
            actualizar_fuente_bd(
                dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x', frecuencia_actualizacion='diaria',
            )
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_FRECUENCIA_INVALIDA')

    def test_frecuencia_sin_fuente_configurada_es_rechazada(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        with self.assertRaises(CarteraError) as ctx:
            actualizar_fuente_bd(dashboard.dashboard_id, tipo='', nombre='', frecuencia_actualizacion='semanal')
        self.assertEqual(ctx.exception.codigo, 'FUENTE_BD_FRECUENCIA_SIN_FUENTE')

    def test_obtener_fuente_bd_devuelve_lo_configurado(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v')
        self.assertEqual(obtener_fuente_bd(dashboard.dashboard_id), {
            'tipo': 'vista', 'nombre': 'dbo.v', 'parametros': {},
            'fecha_formato': 'YYYY-MM-DD', 'frecuencia_actualizacion': '',
            'dia_configuracion_mensual': None, 'ultima_actualizacion': None, 'proxima_actualizacion': None,
        })

    def test_dashboard_sin_fuente_configurada_devuelve_vacio(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        self.assertEqual(obtener_fuente_bd(dashboard.dashboard_id), {
            'tipo': '', 'nombre': '', 'parametros': {},
            'fecha_formato': 'YYYY-MM-DD', 'frecuencia_actualizacion': '',
            'dia_configuracion_mensual': None, 'ultima_actualizacion': None, 'proxima_actualizacion': None,
        })

    def test_obtener_fuente_bd_con_frecuencia_mensual_devuelve_el_dia_anclado(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v', frecuencia_actualizacion='mensual')
        Dashboard.objects.filter(dashboard_id=dashboard.dashboard_id).update(
            fuente_bd_fecha_configuracion=timezone.datetime(2026, 6, 12).date(),
        )
        resultado = obtener_fuente_bd(dashboard.dashboard_id)
        self.assertEqual(resultado['dia_configuracion_mensual'], 12)

    def test_obtener_fuente_bd_con_frecuencia_semanal_no_devuelve_dia_mensual(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v', frecuencia_actualizacion='semanal')
        resultado = obtener_fuente_bd(dashboard.dashboard_id)
        self.assertIsNone(resultado['dia_configuracion_mensual'])

    def test_obtener_fuente_bd_con_frecuencia_configurada_incluye_proxima_actualizacion(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v', frecuencia_actualizacion='semanal')
        resultado = obtener_fuente_bd(dashboard.dashboard_id)
        self.assertIsNotNone(resultado['proxima_actualizacion'])

    def test_obtener_fuente_bd_incluye_la_ultima_carga_procesada(self):
        from apps.cartera.models import CargaArchivo
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v')
        CargaArchivo.objects.create(
            dashboard_id=dashboard.dashboard_id, nombre_original='x.xlsx', estado=CargaArchivo.Estado.PROCESADO,
        )
        resultado = obtener_fuente_bd(dashboard.dashboard_id)
        self.assertIsNotNone(resultado['ultima_actualizacion'])

    def test_obtener_fuente_bd_ignora_cargas_no_procesadas_para_la_ultima_actualizacion(self):
        from apps.cartera.models import CargaArchivo
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v')
        CargaArchivo.objects.create(
            dashboard_id=dashboard.dashboard_id, nombre_original='x.xlsx', estado=CargaArchivo.Estado.VALIDADO,
        )
        resultado = obtener_fuente_bd(dashboard.dashboard_id)
        self.assertIsNone(resultado['ultima_actualizacion'])


class DashboardFuenteBDViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _usuario_con(self, *codenames, username):
        usuario = User.objects.create_user(username=username, email=f'{username}@example.com', password='Clave-Segura-123')
        for codename in codenames:
            usuario.user_permissions.add(Permission.objects.get(codename=codename, content_type__app_label='permissions'))
        return usuario

    def test_get_requiere_poder_ver_el_dashboard(self):
        dashboard = crear_dashboard(nombre='Ventas')
        usuario = User.objects.create_user(username='sin_permisos', email='s@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=usuario)
        resp = self.client.get(f'/api/v1/dashboards/{dashboard.dashboard_id}/fuente-bd')
        self.assertEqual(resp.status_code, 403)

    def test_get_devuelve_la_configuracion_actual(self):
        dashboard = crear_dashboard(nombre='Ventas')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_x', parametros={'FechaCorte': '2026-07-31'})
        usuario = self._usuario_con('dashboard.view', username='con_vista')
        self.client.force_authenticate(user=usuario)
        resp = self.client.get(f'/api/v1/dashboards/{dashboard.dashboard_id}/fuente-bd')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {
            'tipo': 'procedimiento', 'nombre': 'dbo.rpt_x', 'parametros': {'FechaCorte': '2026-07-31'},
            'fecha_formato': 'YYYY-MM-DD', 'frecuencia_actualizacion': '', 'dia_configuracion_mensual': None,
            'ultima_actualizacion': None, 'proxima_actualizacion': None,
        })

    def test_put_sin_permiso_devuelve_403(self):
        dashboard = crear_dashboard(nombre='Ventas')
        usuario = self._usuario_con(username='sin_editar')
        self.client.force_authenticate(user=usuario)
        resp = self.client.put(f'/api/v1/dashboards/{dashboard.dashboard_id}/fuente-bd', {'tipo': 'vista', 'nombre': 'dbo.v'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_put_con_permiso_configura(self):
        dashboard = crear_dashboard(nombre='Ventas')
        usuario = self._usuario_con('dashboard.fuente_bd.configurar', username='con_editar')
        self.client.force_authenticate(user=usuario)
        resp = self.client.put(
            f'/api/v1/dashboards/{dashboard.dashboard_id}/fuente-bd', {'tipo': 'procedimiento', 'nombre': 'dbo.rpt_y'}, format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {
            'tipo': 'procedimiento', 'nombre': 'dbo.rpt_y', 'parametros': {},
            'fecha_formato': 'YYYY-MM-DD', 'frecuencia_actualizacion': '',
        })
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_nombre, 'dbo.rpt_y')

    def test_put_con_parametros_los_guarda(self):
        dashboard = crear_dashboard(nombre='Ventas')
        usuario = self._usuario_con('dashboard.fuente_bd.configurar', username='con_editar_parametros')
        self.client.force_authenticate(user=usuario)
        resp = self.client.put(
            f'/api/v1/dashboards/{dashboard.dashboard_id}/fuente-bd',
            {'tipo': 'procedimiento', 'nombre': 'dbo.rpt_y', 'parametros': {'FechaCorte': '2026-07-31'}},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['parametros'], {'FechaCorte': '2026-07-31'})
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_parametros, {'FechaCorte': '2026-07-31'})

    def test_put_con_fecha_formato_lo_guarda(self):
        dashboard = crear_dashboard(nombre='Ventas')
        usuario = self._usuario_con('dashboard.fuente_bd.configurar', username='con_editar_formato')
        self.client.force_authenticate(user=usuario)
        resp = self.client.put(
            f'/api/v1/dashboards/{dashboard.dashboard_id}/fuente-bd',
            {'tipo': 'procedimiento', 'nombre': 'dbo.rpt_y', 'fecha_formato': 'DD/MM/YYYY'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['fecha_formato'], 'DD/MM/YYYY')
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_fecha_formato, 'DD/MM/YYYY')

    def test_put_con_solo_permiso_de_actualizar_devuelve_403(self):
        """`dashboard.fuente_bd.actualizar` (forzar una recarga) NO alcanza para reconfigurar a
        qué vista/procedimiento apunta el dashboard — son permisos deliberadamente separados."""
        dashboard = crear_dashboard(nombre='Ventas')
        usuario = self._usuario_con('dashboard.fuente_bd.actualizar', username='solo_actualizar')
        self.client.force_authenticate(user=usuario)
        resp = self.client.put(f'/api/v1/dashboards/{dashboard.dashboard_id}/fuente-bd', {'tipo': 'vista', 'nombre': 'dbo.v'}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_put_respeta_el_control_de_acceso_por_dashboard(self):
        """Un usuario sin `dashboard.fuente_bd.configurar` global, pero asignado como editor de
        ESTE dashboard puntual vía `roles_editores`, puede igual configurar su fuente de base de
        datos — antes de este permiso dedicado, el `PUT` caía a un chequeo global ciego al ACL,
        inconsistente con `ConectarFuenteBDView`/`ActualizarFuenteBDAhoraView`."""
        dashboard = crear_dashboard(nombre='Ventas')
        editor = Group.objects.create(name='Editores fuente BD')
        dashboard.roles_editores.add(editor)
        usuario = User.objects.create_user(username='editor_acl', email='ea@example.com', password='Clave-Segura-123')
        usuario.groups.add(editor)
        self.client.force_authenticate(user=usuario)
        resp = self.client.put(f'/api/v1/dashboards/{dashboard.dashboard_id}/fuente-bd', {'tipo': 'vista', 'nombre': 'dbo.v'}, format='json')
        self.assertEqual(resp.status_code, 200)


class ConectarFuenteBDViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        usuario = User.objects.create_superuser(username='tester_fuentebd', email='tfb@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=usuario)

    def test_dashboard_sin_fuente_configurada_devuelve_400(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        resp = self.client.post('/api/v1/cartera/conectar-fuente-bd', {'dashboard_id': dashboard.dashboard_id}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'FUENTE_BD_NO_CONFIGURADA')

    def test_sin_dashboard_id_devuelve_400(self):
        resp = self.client.post('/api/v1/cartera/conectar-fuente-bd', {}, format='json')
        self.assertEqual(resp.status_code, 400)

    @mock.patch('apps.cartera.views.db_source.leer_fuente')
    def test_conecta_y_crea_una_carga_lista_para_el_asistente(self, leer_fuente_mock):
        import pandas as pd
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_Reporte_Seguimiento_Cartera')
        leer_fuente_mock.return_value = pd.DataFrame({'Saldo': [100.0, 200.0], 'Cliente': ['A', 'B']})

        resp = self.client.post('/api/v1/cartera/conectar-fuente-bd', {'dashboard_id': dashboard.dashboard_id}, format='json')

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(sorted(data['columnas_detectadas']), ['Cliente', 'Saldo'])
        self.assertEqual(data['total_filas_detectadas'], 2)
        self.assertEqual(data['hojas_disponibles'], ['Datos'])
        self.assertIn('dbo.rpt_Reporte_Seguimiento_Cartera', data['nombre_archivo'])
        leer_fuente_mock.assert_called_once_with(
            'procedimiento', 'dbo.rpt_Reporte_Seguimiento_Cartera', {}, fecha_formato='YYYY-MM-DD',
        )

        carga = CargaArchivo.objects.get(id=data['carga_id'])
        self.assertEqual(carga.dashboard_id, dashboard.dashboard_id)
        self.assertNotEqual(carga.archivo_temp_nombre, '')
        self.assertEqual(carga.total_filas_excel, 2)

    @mock.patch('apps.cartera.views.db_source.leer_fuente')
    def test_reenvia_los_parametros_configurados(self, leer_fuente_mock):
        import pandas as pd
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_Reporte_Seguimiento_Cartera',
            parametros={'FechaCorte': '2026-07-31'},
        )
        leer_fuente_mock.return_value = pd.DataFrame({'Saldo': [100.0]})

        self.client.post('/api/v1/cartera/conectar-fuente-bd', {'dashboard_id': dashboard.dashboard_id}, format='json')

        leer_fuente_mock.assert_called_once_with(
            'procedimiento', 'dbo.rpt_Reporte_Seguimiento_Cartera', {'FechaCorte': '2026-07-31'}, fecha_formato='YYYY-MM-DD',
        )

    @mock.patch('apps.cartera.views.db_source.leer_fuente')
    def test_la_carga_toma_la_fecha_de_corte_del_parametro(self, leer_fuente_mock):
        """El corte de una fuente de base es su parámetro, no una columna del resultado.

        La carga que sale de acá es la que después leen `aplicar_mapeo` y el reproceso para saber
        contra qué fecha calcular la mora; sin la fecha, la calculaban contra el día de la conexión.
        """
        import pandas as pd
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_Reporte_Seguimiento_Cartera',
            parametros={'FechaCorte': '2026-07-31'},
        )
        leer_fuente_mock.return_value = pd.DataFrame({'Saldo': [100.0]})

        resp = self.client.post('/api/v1/cartera/conectar-fuente-bd', {'dashboard_id': dashboard.dashboard_id}, format='json')

        carga = CargaArchivo.objects.get(id=resp.json()['carga_id'])
        self.assertEqual(carga.fecha_corte, date(2026, 7, 31))

    @mock.patch('apps.cartera.views.db_source.leer_fuente')
    def test_sin_parametros_la_carga_queda_sin_fecha_de_corte(self, leer_fuente_mock):
        # Una vista sin parámetros no dice a qué fecha corresponde: inventarle una sería peor que
        # dejarla vacía (el resto del pipeline ya tiene su propio valor por defecto).
        import pandas as pd
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v_cartera')
        leer_fuente_mock.return_value = pd.DataFrame({'Saldo': [100.0]})

        resp = self.client.post('/api/v1/cartera/conectar-fuente-bd', {'dashboard_id': dashboard.dashboard_id}, format='json')

        self.assertIsNone(CargaArchivo.objects.get(id=resp.json()['carga_id']).fecha_corte)

    @mock.patch('apps.cartera.views.db_source.leer_fuente')
    def test_la_carga_resultante_sirve_para_el_paso_de_mapeo(self, leer_fuente_mock):
        """La carga creada por `ConectarFuenteBDView` debe poder pasar por `/plantilla/sugerir`
        exactamente igual que la de un Excel subido — es el punto central del diseño (reusar todo
        el asistente sin que le importe de dónde vino el archivo)."""
        import pandas as pd
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v_cartera')
        leer_fuente_mock.return_value = pd.DataFrame({'Saldo': [100.0, 200.0], 'Causal': ['X', 'Y']})

        resp = self.client.post('/api/v1/cartera/conectar-fuente-bd', {'dashboard_id': dashboard.dashboard_id}, format='json')
        carga_id = resp.json()['carga_id']

        resp_sugerir = self.client.post('/api/v1/cartera/plantilla/sugerir', {'carga_id': carga_id}, format='json')
        self.assertEqual(resp_sugerir.status_code, 200)

    def test_sin_acceso_al_dashboard_devuelve_403(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v')
        usuario = User.objects.create_user(username='sin_acceso_fbd', email='sa@example.com', password='Clave-Segura-123')
        client = APIClient()
        client.force_authenticate(user=usuario)
        resp = client.post('/api/v1/cartera/conectar-fuente-bd', {'dashboard_id': dashboard.dashboard_id}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_solo_con_permiso_de_actualizar_devuelve_403(self):
        """Conectar (elegir/ejecutar la vista) requiere `dashboard.fuente_bd.configurar`, no
        `dashboard.fuente_bd.actualizar` — son la misma acción de botón que guardar la
        configuración (`DashboardFuenteBDView.put`), comparten permiso."""
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v')
        usuario = User.objects.create_user(username='solo_actualizar_conectar', email='soc@example.com', password='Clave-Segura-123')
        usuario.user_permissions.add(Permission.objects.get(codename='dashboard.fuente_bd.actualizar', content_type__app_label='permissions'))
        client = APIClient()
        client.force_authenticate(user=usuario)
        resp = client.post('/api/v1/cartera/conectar-fuente-bd', {'dashboard_id': dashboard.dashboard_id}, format='json')
        self.assertEqual(resp.status_code, 403)


class ActualizarFuenteBDAhoraViewTests(TestCase):
    """Icono "Actualizar ahora" (solo dashboards con fuente configurada y frecuencia en Manual) —
    corre `fuente_bd_scheduler.actualizar_dashboard` en el momento, sin pasar por el asistente."""

    def setUp(self):
        self.client = APIClient()
        usuario = User.objects.create_superuser(username='tester_ahora', email='ta@example.com', password='Clave-Segura-123')
        self.client.force_authenticate(user=usuario)

    def test_sin_fuente_configurada_devuelve_400(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        resp = self.client.post('/api/v1/cartera/actualizar-fuente-bd-ahora', {'dashboard_id': dashboard.dashboard_id}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'FUENTE_BD_NO_CONFIGURADA')

    def test_sin_dashboard_id_devuelve_400(self):
        resp = self.client.post('/api/v1/cartera/actualizar-fuente-bd-ahora', {}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_sin_mapeo_confirmado_devuelve_200_con_ok_false(self):
        """Nunca es un error HTTP — el frontend decide qué hacer con `ok: False`."""
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v')
        resp = self.client.post('/api/v1/cartera/actualizar-fuente-bd-ahora', {'dashboard_id': dashboard.dashboard_id}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['ok'])

    @mock.patch('apps.cartera.views.fuente_bd_scheduler.db_source.leer_fuente')
    def test_con_mapeo_confirmado_actualiza_en_el_momento(self, leer_fuente_mock):
        import pandas as pd
        from apps.cartera.services import plantilla

        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v')
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'Saldo'}}
        plantilla.aplicar_mapeo(dashboard.dashboard_id, pd.DataFrame({'Saldo': [1.0]}), mapeo)
        Dashboard.objects.filter(dashboard_id=dashboard.dashboard_id).update(fuente_bd_ultimo_mapeo=mapeo)
        leer_fuente_mock.return_value = pd.DataFrame({'Saldo': [500.0, 600.0]})

        resp = self.client.post('/api/v1/cartera/actualizar-fuente-bd-ahora', {'dashboard_id': dashboard.dashboard_id}, format='json')

        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['ok'], resp.json()['mensaje'])

    def test_sin_acceso_al_dashboard_devuelve_403(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v')
        usuario = User.objects.create_user(username='sin_acceso_ahora', email='saa@example.com', password='Clave-Segura-123')
        client = APIClient()
        client.force_authenticate(user=usuario)
        resp = client.post('/api/v1/cartera/actualizar-fuente-bd-ahora', {'dashboard_id': dashboard.dashboard_id}, format='json')
        self.assertEqual(resp.status_code, 403)

    def test_solo_con_permiso_de_configurar_devuelve_403(self):
        """Forzar una recarga inmediata requiere `dashboard.fuente_bd.actualizar`, no
        `dashboard.fuente_bd.configurar` — poder cambiar a qué vista/procedimiento apunta el
        dashboard no implica poder disparar una recarga con la config ya elegida."""
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(dashboard.dashboard_id, tipo='vista', nombre='dbo.v')
        usuario = User.objects.create_user(username='solo_configurar_ahora', email='sca@example.com', password='Clave-Segura-123')
        usuario.user_permissions.add(Permission.objects.get(codename='dashboard.fuente_bd.configurar', content_type__app_label='permissions'))
        client = APIClient()
        client.force_authenticate(user=usuario)
        resp = client.post('/api/v1/cartera/actualizar-fuente-bd-ahora', {'dashboard_id': dashboard.dashboard_id}, format='json')
        self.assertEqual(resp.status_code, 403)

    @mock.patch('apps.cartera.views.fuente_bd_scheduler.db_source.leer_fuente')
    def test_con_fecha_corte_ejecuta_el_procedimiento_con_esa_fecha_y_la_guarda(self, leer_fuente_mock):
        """Sin frecuencia no hay período que avanzar: reenviar la fecha guardada traía exactamente los
        mismos datos que la vez anterior. La fecha elegida al pulsar es la que viaja al procedimiento
        y queda guardada para la próxima."""
        import pandas as pd
        from apps.cartera.services import plantilla

        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_cartera',
            parametros={'FechaCorte': '2026-09-30'},
        )
        mapeo = {'kpi-1': {'disponible': True, 'columna_valor': 'Saldo'}}
        plantilla.aplicar_mapeo(dashboard.dashboard_id, pd.DataFrame({'Saldo': [1.0]}), mapeo)
        Dashboard.objects.filter(dashboard_id=dashboard.dashboard_id).update(fuente_bd_ultimo_mapeo=mapeo)
        leer_fuente_mock.return_value = pd.DataFrame({'Saldo': [500.0]})

        resp = self.client.post(
            '/api/v1/cartera/actualizar-fuente-bd-ahora',
            {'dashboard_id': dashboard.dashboard_id, 'fecha_corte': '2026-10-13'}, format='json',
        )

        self.assertTrue(resp.json()['ok'], resp.json()['mensaje'])
        self.assertEqual(leer_fuente_mock.call_args.args[2], {'FechaCorte': '2026-10-13'})
        dashboard.refresh_from_db()
        self.assertEqual(dashboard.fuente_bd_parametros, {'FechaCorte': '2026-10-13'})
        carga = CargaArchivo.objects.filter(dashboard_id=dashboard.dashboard_id).order_by('-fecha_carga').first()
        self.assertEqual(carga.fecha_corte.isoformat(), '2026-10-13')

    def test_fecha_corte_invalida_devuelve_400(self):
        dashboard = crear_dashboard(nombre='Cobranza')
        actualizar_fuente_bd(
            dashboard.dashboard_id, tipo='procedimiento', nombre='dbo.rpt_cartera',
            parametros={'FechaCorte': '2026-09-30'},
        )
        resp = self.client.post(
            '/api/v1/cartera/actualizar-fuente-bd-ahora',
            {'dashboard_id': dashboard.dashboard_id, 'fecha_corte': '13/10/2026'}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'FECHA_CORTE_INVALIDA')
