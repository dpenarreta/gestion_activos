import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { matrizService } from "../../api/servicios";
import { Alerta, Cargando, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { ESTADOS_DE_LA_BANDEJA, horaDeLaZona, mensajeDeMatriz } from "../../matriz/formato";
import { TONOS } from "../../soporte/formato";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { Separador } from "../soporte/piezas";
import { FilaPeriodo, MatrizEnElNavegador, SinRolMatriz } from "./piezas";

/** Una tarjeta del resumen (CA-2): ícono, título, cifra y detalle, con el
 * borde y el ícono del tono. El color nunca es lo único que la distingue. */
function Tarjeta({ estado, counts, onAbrir }) {
  const tono = TONOS[estado.tono];
  const cifra = Number(estado.cifra(counts)) || 0;
  // H-19 (ronda 1): con algo incumplido, esa tarjeta va primero, a todo el
  // ancho y destacada (fondo y borde del tono, no solo el color).
  const destacada = estado.clave === "incumplido" && cifra > 0;
  const detalle = estado.detalle(counts);
  return (
    <Pressable
      testID={`tarjeta-${estado.clave}`}
      onPress={() => onAbrir(estado)}
      accessibilityRole="button"
      accessibilityLabel={`${estado.titulo}: ${cifra}. ${detalle}`}
      accessibilityHint="Abre la lista de estas obligaciones"
      style={({ pressed }) => [
        estilos.tarjeta,
        { borderLeftColor: tono.color },
        destacada && [estilos.destacada, { backgroundColor: tono.fondo, borderColor: tono.color }],
        pressed && estilos.presionada,
      ]}
    >
      <View style={estilos.tarjetaCabecera}>
        <View style={[estilos.tarjetaIcono, { backgroundColor: tono.fondo }]}>
          <Icono nombre={estado.icono} size={22} color={tono.color} />
        </View>
        <Text style={estilos.tarjetaTitulo}>{estado.titulo}</Text>
      </View>
      <Text style={estilos.cifra}>{cifra}</Text>
      <Text style={estilos.tenue}>{detalle}</Text>
    </Pressable>
  );
}

/**
 * La Bandeja de la Matriz (US-019, CA-2): las cuatro cifras de la web
 * (`GET matriz/resumen/`) en tarjetas que llevan a su lista (CA-3), los
 * próximos vencimientos y los cierres recientes, y lo que se hace en la web.
 * Sin `ver_todas`, el servidor ya lo limita a los períodos propios. Se
 * actualiza al volver a ella (tras una acción en el detalle, CA-5) y al tirar
 * hacia abajo; un refresco fallido no borra lo que se ve.
 */
export function BandejaMatriz({ matriz, permisos, empresaActiva, onAbrirEstado, onAbrirPeriodo }) {
  const [carga, setCarga] = useState({ estado: "cargando", datos: null, error: null, aviso: null });
  const [refrescando, setRefrescando] = useState(false);
  const montado = useRef(true);
  const consulta = useRef(0);
  const cargaRef = useRef(carga);
  cargaRef.current = carga;
  const lista = matriz.estado === "listo";

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(async ({ silenciosa = false } = {}) => {
    const numero = ++consulta.current;
    if (!silenciosa) setCarga({ estado: "cargando", datos: null, error: null, aviso: null });
    try {
      const datos = await matrizService.resumen();
      if (!montado.current || numero !== consulta.current) return;
      setCarga({ estado: "listo", datos, error: null, aviso: null });
    } catch (e) {
      if (!montado.current || numero !== consulta.current) return;
      const sinRol = e?.response?.status === 404;
      if (silenciosa && cargaRef.current.estado === "listo" && !sinRol) {
        setCarga((c) => ({
          ...c,
          aviso: `${mensajeDeMatriz(e, "No se pudo actualizar el resumen.")} Se muestra el anterior.`,
        }));
      } else {
        setCarga({
          estado: sinRol ? "sin_rol" : "error",
          datos: null,
          error: sinRol ? undefined : mensajeDeMatriz(e, "No se pudo cargar el resumen."),
          aviso: null,
        });
      }
    }
  }, []);

  useEffect(() => {
    if (lista) cargar();
  }, [lista, matriz.empresa, cargar]);

  // CA-5: al volver del detalle (o de otra pestaña), las cifras al día.
  const primeraVez = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeraVez.current) {
        primeraVez.current = false;
        return;
      }
      if (cargaRef.current.estado === "listo") cargar({ silenciosa: true });
    }, [cargar]), // `cargar` no cambia: no repite la petición.
  );

  async function refrescar() {
    setRefrescando(true);
    if (matriz.estado === "error") matriz.recargar();
    else await cargar({ silenciosa: cargaRef.current.estado === "listo" });
    if (montado.current) setRefrescando(false);
  }

  const zona = matriz.zona;
  const pie = <MatrizEnElNavegador permisos={permisos} empresa={empresaActiva} />;

  let contenido;
  if (matriz.estado === "cargando") contenido = <Cargando texto="Cargando la Matriz…" />;
  else if (matriz.estado === "sin_rol") contenido = <SinRolMatriz />;
  else if (matriz.estado === "error") {
    contenido = (
      <ErrorConReintento
        texto={mensajeDeMatriz(matriz.error, "No se pudo cargar la Matriz.")}
        onReintentar={matriz.recargar}
      />
    );
  } else if (carga.estado === "cargando") contenido = <Cargando texto="Cargando el resumen…" />;
  else if (carga.estado === "sin_rol") contenido = <SinRolMatriz texto={carga.error} />;
  else if (carga.estado === "error")
    contenido = <ErrorConReintento texto={carga.error} onReintentar={() => cargar()} />;
  else {
    const { counts, upcoming = [], recent_closures: cierres = [] } = carga.datos ?? {};
    contenido = (
      <>
        {carga.aviso ? <Alerta tipo="mal" texto={carga.aviso} /> : null}
        <View style={estilos.tarjetas} testID="tarjetas-matriz">
          {ESTADOS_DE_LA_BANDEJA.map((e) => (
            <Tarjeta key={e.clave} estado={e} counts={counts} onAbrir={onAbrirEstado} />
          ))}
        </View>
        <View style={estilos.bloque} testID="proximos-vencimientos">
          <Text style={estilos.subtitulo} accessibilityRole="header">
            Próximos vencimientos
          </Text>
          {upcoming.length === 0 ? (
            <Vacio icono="book-check-outline" texto="Nada pendiente. Las obligaciones abiertas aparecerán aquí." />
          ) : (
            upcoming.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <Separador /> : null}
                <FilaPeriodo periodo={p} zona={zona} onAbrir={onAbrirPeriodo} />
              </View>
            ))
          )}
        </View>
        <View style={estilos.bloque} testID="cierres-recientes">
          <Text style={estilos.subtitulo} accessibilityRole="header">
            Cierres recientes
          </Text>
          {cierres.length === 0 ? (
            <Vacio icono="check-circle-outline" texto="Todavía no hay cierres validados." />
          ) : (
            cierres.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <Separador /> : null}
                <FilaPeriodo periodo={p} zona={zona} onAbrir={onAbrirPeriodo} />
              </View>
            ))
          )}
        </View>
      </>
    );
  }

  return (
    <ScrollView
      testID="bandeja-matriz"
      style={estilos.lista}
      contentContainerStyle={estilos.contenido}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
    >
      {lista ? (
        <View style={estilos.empresa}>
          <Text style={estilos.empresaNombre}>{matriz.empresa.nombre}</Text>
          {Array.isArray(matriz.empresa.roles) && matriz.empresa.roles.length > 0 ? (
            <Text style={estilos.tenue}>{`Su rol: ${matriz.empresa.roles.join(", ")}`}</Text>
          ) : null}
          {horaDeLaZona(zona) ? (
            <Text style={estilos.tenue}>{`Los vencimientos van en la ${horaDeLaZona(zona)}.`}</Text>
          ) : null}
        </View>
      ) : null}
      {contenido}
      {lista ? <View style={estilos.pie}>{pie}</View> : null}
    </ScrollView>
  );
}

const estilos = crearEstilos({
  lista: { flex: 1 },
  contenido: { padding: 16, paddingTop: 8, paddingBottom: 32, gap: 16 },
  empresa: { gap: 2 },
  empresaNombre: { fontSize: 18, fontWeight: "700", color: colores.titulo },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  tarjetas: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  destacada: { flexBasis: "100%", borderWidth: 2, borderLeftWidth: 8 },
  tarjeta: {
    flexGrow: 1,
    flexBasis: 150,
    minHeight: AREA_TACTIL,
    padding: 12,
    gap: 4,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
    borderLeftWidth: 6,
  },
  presionada: { backgroundColor: colores.realce },
  tarjetaCabecera: { flexDirection: "row", alignItems: "center", gap: 8 },
  tarjetaIcono: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tarjetaTitulo: { flex: 1, fontSize: 15, fontWeight: "700", color: colores.tinta },
  cifra: { fontSize: 30, fontWeight: "700", color: colores.titulo },
  bloque: { gap: 10 },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.titulo },
  pie: { marginTop: 4 },
});
