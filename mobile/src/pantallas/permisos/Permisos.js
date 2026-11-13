import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native";

import { mensajeDeError } from "../../api/errores";
import { licenciasService } from "../../api/servicios";
import { Alerta, Boton, BotonIcono, Cargando, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { TEXTO_SIN_ROL, useResumenPermisos } from "../../permisos/ResumenPermisosContext";
import { useSesion } from "../../sesion/SesionContext";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { MisVacaciones } from "./MisVacaciones";
import { AbrirEnLaWeb, TarjetaSolicitud } from "./piezas";
import { crearEstilos } from "../../tema/tipografia";

/**
 * La pestaña «Permisos» (US-010, CA-1): «Mis solicitudes», «Por aprobar» y
 * «Mis vacaciones». «Por aprobar» está siempre, como en la web: vacía y sin
 * insignia si no hay nada pendiente (revisión de QA, D-1).
 *
 * `?seccion=` (desde el Inicio o un aviso) elige la sección; `n` cambia en
 * cada toque para que el mismo acceso vuelva a llevar a ella.
 */
export const SECCIONES = [
  // WCAG 2.5.3: el nombre accesible empieza por lo que se ve (N-03).
  { id: "mias", titulo: "Mías: mis solicitudes", corto: "Mías" },
  { id: "por_aprobar", titulo: "Por aprobar", corto: "Por aprobar" },
  { id: "vacaciones", titulo: "Mis vacaciones", corto: "Vacaciones" },
];

/** Con la letra del sistema a partir de este tamaño, los segmentos pasan a
 * una columna: en una fila de 360 dp no caben sin cortarse (N-01). */
export const ESCALA_SEGMENTOS_EN_COLUMNA = 1.15;

export const TEXTO_SOLO_EN_LA_WEB =
  "Ver todas las solicitudes de la empresa, escalar, anular una aprobada y configurar los tipos de permiso se hace en la web.";

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

export function Permisos() {
  const router = useRouter();
  const parametros = useLocalSearchParams();
  const pedida = primero(parametros.seccion);
  const toque = primero(parametros.n);
  const { usuario, empresaActiva } = useSesion();
  const { porAprobar, puedeSolicitar, cargado, recargar } = useResumenPermisos();
  const [seccion, setSeccion] = useState(
    SECCIONES.some((s) => s.id === pedida) ? pedida : "mias",
  );
  // Sube al volver a la pestaña: las listas se refrescan sin «Cargando».
  const [foco, setFoco] = useState(0);
  const permisos = usuario?.permissions ?? [];
  const { fontScale } = useWindowDimensions();
  const enColumna = fontScale >= ESCALA_SEGMENTOS_EN_COLUMNA;

  useEffect(() => {
    if (SECCIONES.some((s) => s.id === pedida)) setSeccion(pedida);
  }, [pedida, toque]);

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

  const visibles = SECCIONES;
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
    <View style={estilos.pantalla}>
      <View
        style={[estilos.secciones, enColumna && estilos.seccionesEnColumna]}
        accessibilityRole="tablist"
        accessibilityLabel="Secciones de permisos"
        testID="secciones"
      >
        {visibles.map((s) => {
          const activa = s.id === seccion;
          const cuenta = s.id === "por_aprobar" && porAprobar > 0 ? porAprobar : 0;
          return (
            <Pressable
              key={s.id}
              testID={`seccion-${s.id}`}
              onPress={() => setSeccion(s.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: activa }}
              accessibilityLabel={cuenta ? `${s.titulo}, ${cuenta} por aprobar` : s.titulo}
              style={[estilos.seccion, enColumna && estilos.seccionEnColumna, activa && estilos.seccionActiva]}
            >
              {/* Texto corto para que quepan en una fila; el lector dice el
                  título completo. Sin `numberOfLines`: con la letra al 200 %
                  baja a dos líneas dentro del segmento (auditoría UX, H-02). */}
              <Text style={[estilos.seccionTexto, activa && estilos.seccionTextoActivo]}>{s.corto}</Text>
              {cuenta ? (
                <View style={estilos.insignia}>
                  <Text style={estilos.insigniaTexto}>{cuenta > 99 ? "99+" : cuenta}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

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
  // Control segmentado de una fila (auditoría UX, H-02): cada segmento
  // ocupa lo mismo; el activo, negro con texto blanco (16,7:1).
  secciones: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    padding: 4,
    gap: 4,
    borderRadius: 10,
    backgroundColor: colores.hundido,
  },
  seccion: {
    flex: 1,
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 8,
  },
  seccionActiva: { backgroundColor: colores.primario },
  seccionesEnColumna: { flexDirection: "column" },
  seccionEnColumna: { flex: 0, justifyContent: "flex-start", paddingHorizontal: 12 },
  seccionTexto: { fontSize: 15, fontWeight: "600", color: colores.tinta, textAlign: "center", flexShrink: 1 },
  seccionTextoActivo: { color: colores.sobrePrimario },
  insignia: CONTROLES.insignia,
  insigniaTexto: CONTROLES.insigniaTexto,
  lista: { flex: 1 },
  contenido: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  cabeceraLista: { gap: 10, marginBottom: 10 },
  filaCabecera: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cabeceraPropia: { flex: 1, gap: 10 },
  separador: { height: 10 },
  pie: { marginTop: 20 },
});
