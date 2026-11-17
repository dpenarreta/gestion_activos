import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";

import { Alerta, Boton } from "../../componentes/comunes";
import { BotonRedondo, CuadriculaRedonda } from "../../componentes/BotonRedondo";
import { Icono } from "../../componentes/Icono";
import { abrirEnNavegador, TEXTO_NAVEGADOR_FALLO, urlWeb } from "../../navegador/enlaceWeb";
import { moduloPorId, vistaActiva } from "../../navegacion/modulos";
import { useContextoDeNavegacion } from "../../navegacion/useContextoDeNavegacion";
import { useSesion } from "../../sesion/SesionContext";
import { tomarAviso } from "../../soporte/avisoPendiente";
import { accesosEnElNavegador, rutaDeAltaPropia } from "../../soporte/formato";
import { useRecargarResumenSoporte } from "../../soporte/ResumenSoporteContext";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { Aprobaciones } from "./Aprobaciones";
import { Bandeja } from "./Bandeja";
import { MisTickets } from "./MisTickets";
import { TEXTO_SIN_PERMISO_PARA_CREAR } from "./NuevoTicket";

/**
 * La Mesa de ayuda en la app (US-014, CA-1, CA-20). Desde la US-016
 * (13/11/2026) es un módulo con su pestaña arriba, y sus vistas se eligen en
 * la barra de abajo (`navegacion/modulos.js`), con las reglas de siempre:
 *
 * - «Mis tickets», siempre;
 * - «Bandeja» del equipo, con `atender`, `ver_todos`, `asignar` o
 *   `registrar` (se confirma con `GET tickets/bandeja/`; un 403 la quita sin
 *   error, aquí y en la barra);
 * - «Aprobaciones», si hay alguna pendiente (o si un aviso lleva a ellas).
 *
 * Abajo, lo de escritorio que se abre en el navegador. La vista sale de
 * `?vista=` (la barra, el Inicio y los avisos); sin ella, el equipo entra a la
 * bandeja y los demás a sus tickets.
 */
const MODULO_MESA = moduloPorId("mesa");

/** H-10: el título pequeño de cada vista. */
const TITULOS = { mis: "Mis tickets", bandeja: "Bandeja del equipo", aprobaciones: "Aprobaciones" };

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/** CA-20: reportes, configuración, formulario, «Mi horario» y horas, en la
 * web. */
export function MasEnElNavegador({ permisos, empresa }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const [error, setError] = useState(null);
  const accesos = accesosEnElNavegador(permisos);
  if (accesos.length === 0) return null;
  async function abrir(ruta) {
    setError(null);
    const abierta = await abrirEnNavegador(urlWeb(ruta, { empresa }), { avisarSiFalla: false });
    if (abierta === false) setError(TEXTO_NAVEGADOR_FALLO);
  }
  return (
    <View style={estilos.navegador} testID="mas-en-el-navegador">
      <View style={estilos.navegadorTitulo}>
        <Text style={estilos.subtitulo} accessibilityRole="header">
          Más opciones en el navegador
        </Text>
        <Icono nombre="open-in-new" size={18} color={colores.tintaSuave} />
      </View>
      <Text style={estilos.tenue}>Se abren en el navegador del teléfono.</Text>
      {/* Botones redondos con la marca de «sale de la app» (16/11/2026). */}
      <CuadriculaRedonda columnas={3}>
        {(ancho) =>
          accesos.map((a) => (
            <BotonRedondo
              key={a.ruta}
              testID={`web-${a.ruta}`}
              icono={a.icono}
              nombre={a.nombre}
              familia="soporte"
              navegador
              ancho={ancho}
              onPress={() => abrir(a.ruta)}
            />
          ))
        }
      </CuadriculaRedonda>
      {error ? <Alerta tipo="mal" texto={error} /> : null}
    </View>
  );
}

export function MesaDeAyuda() {
  const estilos = useEstilos(fabricaDeEstilos);
  const router = useRouter();
  const parametros = useLocalSearchParams();
  const { usuario, empresaActiva } = useSesion();
  const { recargar, informarMisTickets, marcarNoEsDelEquipo } = useRecargarResumenSoporte();
  const permisos = usuario?.permissions ?? [];
  // El 403 de la bandeja lo guarda el resumen (`marcarNoEsDelEquipo`), que lo
  // vuelve a comprobar al cambiar de empresa (G-9): la Mesa y la barra lo
  // leen de ahí.
  const contexto = useContextoDeNavegacion({ mesa: primero(parametros.vista) });
  const actual = vistaActiva(MODULO_MESA, { name: "soporte", params: parametros }, contexto);
  const [aviso, setAviso] = useState(null);

  // CA-15: lo que dejó la ficha al volver (escalado o reasignado). H-15: al
  // volver otra vez, el aviso anterior ya no se muestra.
  useFocusEffect(
    useCallback(() => {
      const texto = tomarAviso();
      setAviso(texto ? { texto, clave: Date.now() } : null);
    }, []),
  );

  const alNoSerDelEquipo = useCallback(() => marcarNoEsDelEquipo(), [marcarNoEsDelEquipo]);
  const abrirMiTicket = useCallback(
    (t) => router.push({ pathname: "/soporte/mi-ticket/[id]", params: { id: String(t.id) } }),
    [router],
  );
  const abrirTicket = useCallback(
    (t) => router.push({ pathname: "/soporte/ticket/[id]", params: { id: String(t.id) } }),
    [router],
  );
  // T1: «Mis tickets» ya trae su lista; el refresco pide solo lo demás.
  const recargarSinMisTickets = useCallback(() => recargar({ sinMisTickets: true }), [recargar]);

  const alta = rutaDeAltaPropia(permisos);
  const pie = <MasEnElNavegador permisos={permisos} empresa={empresaActiva?.id} />;
  return (
    <View style={estilos.pantalla} testID={`mesa-de-ayuda-${actual}`}>
      {/* H-10: qué vista es, sin mirar la barra de abajo. */}
      <Text style={estilos.tituloVista} accessibilityRole="header">
        {TITULOS[actual]}
      </Text>
      {aviso ? (
        <View style={estilos.aviso}>
          <Alerta tipo="bien" texto={aviso.texto} clave={aviso.clave} testID="aviso-mesa" />
        </View>
      ) : null}

      {actual === "bandeja" ? (
        <Bandeja onAbrir={abrirTicket} onNoEsDelEquipo={alNoSerDelEquipo} pie={pie} alActualizar={recargar} />
      ) : actual === "aprobaciones" ? (
        <Aprobaciones pie={pie} alActualizar={recargar} />
      ) : (
        <MisTickets
          onAbrir={abrirMiTicket}
          alActualizar={recargarSinMisTickets}
          alCargar={informarMisTickets}
          pie={pie}
          cabecera={
            alta ? (
              <Boton
                testID="nuevo-ticket"
                titulo="Nuevo ticket"
                icono="plus"
                pista="Pida ayuda a TI a su nombre"
                onPress={() => router.push("/soporte/nuevo")}
              />
            ) : (
              <Text style={estilos.tenue} testID="sin-permiso-crear">
                {TEXTO_SIN_PERMISO_PARA_CREAR}
              </Text>
            )
          }
        />
      )}
    </View>
  );
}

const fabricaDeEstilos = (colores, CONTROLES) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  tituloVista: CONTROLES.tituloVista,
  aviso: { paddingHorizontal: 16 },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  navegador: { gap: 8 },
  navegadorTitulo: { flexDirection: "row", alignItems: "center", gap: 8 },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.titulo },
});
