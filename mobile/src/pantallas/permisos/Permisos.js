import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";

import { mensajeDeError } from "../../api/errores";
import { licenciasService } from "../../api/servicios";
import {
  Alerta,
  Boton,
  BotonIcono,
  Cargando,
  ErrorConReintento,
  Vacio,
} from "../../componentes/comunes";
import { TEXTO_SIN_ROL, useResumenPermisos } from "../../permisos/ResumenPermisosContext";
import { useSesion } from "../../sesion/SesionContext";
import { colores } from "../../tema/colores";
import { MisVacaciones } from "./MisVacaciones";
import { AbrirEnLaWeb, TarjetaSolicitud } from "./piezas";
import { crearEstilos } from "../../tema/tipografia";

/**
 * Los permisos del módulo «Institucional» (US-010, CA-1; US-016): «Solicitud
 * de permisos» (las mías), «Por aprobar» y «Consulta de vacaciones». Desde la US-016 (13/11/2026) no hay controles
 * segmentados arriba: las secciones se eligen en la barra de abajo
 * (`navegacion/modulos.js`) y la sección sale de `?seccion=` de la ruta, que
 * ya usaban el Inicio y los avisos.
 */
export const SECCIONES = [
  { id: "mias", titulo: "Solicitud de permisos" },
  { id: "por_aprobar", titulo: "Por aprobar" },
  { id: "vacaciones", titulo: "Consulta de vacaciones" },
];

/** La sección de `?seccion=`; sin ella o si no vale, la de mis solicitudes. */
export function seccionDeLaRuta(pedida) {
  return SECCIONES.some((s) => s.id === pedida) ? pedida : "mias";
}

export const TEXTO_SOLO_EN_LA_WEB =
  "Ver todas las solicitudes de la empresa, escalar, anular una aprobada y configurar los tipos de permiso se hace en la web.";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

export function Permisos() {
  const router = useRouter();
  const parametros = useLocalSearchParams();
  const seccion = seccionDeLaRuta(primero(parametros.seccion));
  const { usuario, empresaActiva } = useSesion();
  const { puedeSolicitar, cargado, recargar } = useResumenPermisos();
  // Sube al volver a la pestaña: las listas se refrescan sin «Cargando».
  const [foco, setFoco] = useState(0);
  const permisos = usuario?.permissions ?? [];

  const primeraVez = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeraVez.current) {
        primeraVez.current = false;
        return;
      }
      recargar();
      setFoco((f) => f + 1);
    }, [recargar]),
  );

  const soloEnLaWeb = permisos.includes("licencias.ver_todas") || permisos.includes("licencias.configurar");

  const abrir = useCallback(
    (solicitud) => router.push(`/permisos/solicitud/${solicitud.id}`),
    [router],
  );

  const sinRol = cargado && !puedeSolicitar;
  const cabeceraMias = (
    <View style={estilos.cabeceraLista}>
      <Boton
        testID="nueva-solicitud"
        titulo="Nueva solicitud"
        icono="plus"
        deshabilitado={sinRol}
        pista={sinRol ? TEXTO_SIN_ROL : "Abre el formulario para pedir un permiso"}
        onPress={() => router.push("/permisos/nueva")}
      />
      {sinRol && <Alerta tipo="aviso" texto={TEXTO_SIN_ROL} />}
    </View>
  );

  return (
    <View style={estilos.pantalla} testID={`institucional-${seccion}`}>
      {/* H-10: qué vista es, sin mirar la barra de abajo. */}
      <Text style={estilos.tituloVista} accessibilityRole="header">
        {SECCIONES.find((s) => s.id === seccion).titulo}
      </Text>
      {seccion === "vacaciones" ? (
        <MisVacaciones foco={foco} />
      ) : (
        <ListaSolicitudes
          key={seccion}
          vista={seccion}
          foco={foco}
          onAbrir={abrir}
          cabecera={seccion === "mias" ? cabeceraMias : null}
          pie={
            seccion === "mias" && soloEnLaWeb ? (
              <AbrirEnLaWeb
                ruta="/admin/institucional/permisos"
                empresa={empresaActiva?.id}
                texto={TEXTO_SOLO_EN_LA_WEB}
                testID="permisos-en-la-web"
              />
            ) : null
          }
          alActualizar={recargar}
        />
      )}
    </View>
  );
}

/**
 * Una lista de solicitudes (`vista`: `mias` o `por_aprobar`). Se recarga al
 * cambiar de empresa (CA-13), al volver a la pestaña y al deslizar hacia
 * abajo (CA-3). Si un refresco falla con la lista a la vista, la conserva y
 * lo dice.
 */
export function ListaSolicitudes({ vista, foco = 0, onAbrir, cabecera = null, pie = null, alActualizar }) {
  const { versionEmpresa } = useSesion();
  const [estado, setEstado] = useState("cargando");
  const [lista, setLista] = useState([]);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  const montado = useRef(true);
  const consulta = useRef(0);
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(
    async ({ silenciosa = false } = {}) => {
      const numero = ++consulta.current;
      setAviso(null);
      if (!silenciosa) setEstado("cargando");
      try {
        const datos = await licenciasService.solicitudes(vista);
        if (!montado.current || numero !== consulta.current) return;
        setLista(Array.isArray(datos) ? datos : Array.isArray(datos?.results) ? datos.results : []);
        setEstado("listo");
        setError(null);
      } catch (e) {
        if (!montado.current || numero !== consulta.current) return;
        if (silenciosa && estadoRef.current === "listo") {
          setAviso(
            `${mensajeDeError(e, "No se pudieron actualizar las solicitudes.")} Se muestran las anteriores.`,
          );
        } else {
          setError(mensajeDeError(e, "No se pudieron cargar las solicitudes."));
          setEstado("error");
        }
      }
    },
    [vista],
  );

  useEffect(() => {
    cargar();
  }, [cargar, versionEmpresa]);

  const focoInicial = useRef(foco);
  useEffect(() => {
    if (foco !== focoInicial.current) cargar({ silenciosa: true });
  }, [foco, cargar]);

  async function refrescar() {
    setRefrescando(true);
    await Promise.all([cargar({ silenciosa: true }), alActualizar?.()]);
    if (montado.current) setRefrescando(false);
  }

  const conSolicitante = vista !== "mias";
  const renderItem = useCallback(
    ({ item }) => <TarjetaSolicitud solicitud={item} conSolicitante={conSolicitante} onAbrir={onAbrir} />,
    [conSolicitante, onAbrir],
  );

  let vacio;
  if (estado === "cargando") vacio = <Cargando texto="Cargando solicitudes…" />;
  else if (estado === "error") vacio = <ErrorConReintento texto={error} onReintentar={() => cargar()} />;
  else
    vacio = (
      <Vacio
        icono="calendar-blank-outline"
        texto={vista === "por_aprobar" ? "No tiene solicitudes por aprobar." : "No tiene solicitudes."}
      />
    );

  return (
    <FlatList
      testID={`lista-${vista}`}
      style={estilos.lista}
      contentContainerStyle={estilos.contenido}
      data={estado === "listo" ? lista : []}
      keyExtractor={(s) => String(s.id)}
      ListHeaderComponent={
        <View style={estilos.cabeceraLista}>
          <View style={estilos.filaCabecera}>
            <View style={estilos.cabeceraPropia}>{cabecera}</View>
            {/* Alternativa a deslizar hacia abajo, que no todos conocen ni
                todos pueden hacer (revisión de QA-UX). En la misma fila, para
                que se vea más de la lista (auditoría UX, H-02). */}
            <BotonIcono
              testID={`actualizar-${vista}`}
              icono="refresh"
              variante="contorno"
              etiqueta={refrescando ? "Actualizando…" : "Actualizar la lista"}
              cargando={refrescando}
              onPress={refrescar}
            />
          </View>
          {aviso ? <Alerta tipo="mal" texto={aviso} /> : null}
        </View>
      }
      ListEmptyComponent={vacio}
      ListFooterComponent={pie ? <View style={estilos.pie}>{pie}</View> : null}
      renderItem={renderItem}
      ItemSeparatorComponent={Separador}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
    />
  );
}

function Separador() {
  return <View style={estilos.separador} />;
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  tituloVista: { paddingHorizontal: 16, paddingTop: 12, fontSize: 15, fontWeight: "700", color: colores.tintaSuave },
  lista: { flex: 1 },
  contenido: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  cabeceraLista: { gap: 10, marginBottom: 10 },
  filaCabecera: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cabeceraPropia: { flex: 1, gap: 10 },
  separador: { height: 10 },
  pie: { marginTop: 20 },
});
