import { useFocusEffect } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { matrizService } from "../../api/servicios";
import { Alerta, Boton, BotonIcono, Cargando, ErrorConReintento } from "../../componentes/comunes";
import {
  cuantas,
  DIAS_SEMANA,
  diaConSemana,
  diaEnZona,
  grupoMasUrgente,
  horaDeLaZona,
  mensajeDeMatriz,
  moverMes,
  semanasDelMes,
  TEXTO_SIN_ROL,
  tituloDelMes,
  tonoDeGrupo,
} from "../../matriz/formato";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { SinRolMatriz } from "./piezas";

/** Sin obligaciones: siempre la misma lista, para que `memo(Dia)` sirva. */
const SIN_PERIODOS = [];

/** H-08 (ronda 1): en Android el título del mes es una región viva y ya se
 * lee al cambiar; anunciarlo además lo decía dos veces. */
function anunciarMes(texto) {
  if (Platform.OS === "ios") anunciar(texto);
}

/** «viernes 13 de noviembre de 2026, hoy, 2 obligaciones, 1 incumplida»
 * (H-07: con el día de la semana). */
export function nombreDelDia(dia, lista, hoy) {
  const partes = [diaConSemana(dia.iso)];
  if (dia.iso === hoy) partes.push("hoy");
  if (!dia.delMes) partes.push("de otro mes");
  partes.push(lista.length ? cuantas(lista.length) : "sin obligaciones");
  const incumplidas = lista.filter((p) => p?.estado?.group === "incumplido").length;
  if (incumplidas) partes.push(incumplidas === 1 ? "1 incumplida" : `${incumplidas} incumplidas`);
  return partes.join(", ");
}

/**
 * Un día de la cuadrícula: su número y, si vence algo, una marca con el
 * número de obligaciones en el color de la más urgente (el número y el
 * nombre accesible lo dicen sin el color, CA-9). Hoy, con borde grueso.
 * Sin obligaciones no lleva a ningún lado.
 */
const Dia = memo(function Dia({ dia, lista, hoy, onAbrir, ancho }) {
  const cuenta = lista.length;
  const grupo = grupoMasUrgente(lista);
  const tono = grupo ? tonoDeGrupo(grupo) : null;
  const esHoy = dia.iso === hoy;
  return (
    <Pressable
      testID={`dia-${dia.iso}`}
      onPress={() => onAbrir(dia.iso)}
      disabled={cuenta === 0}
      accessibilityRole="button"
      accessibilityLabel={nombreDelDia(dia, lista, hoy)}
      accessibilityHint={cuenta ? "Abre las obligaciones de ese día" : undefined}
      accessibilityState={{ disabled: cuenta === 0 }}
      style={({ pressed }) => [
        estilos.dia,
        ancho ? { width: ancho, flex: 0 } : null,
        !dia.delMes && estilos.diaDeOtroMes,
        esHoy && estilos.hoy,
        pressed && cuenta > 0 && estilos.presionada,
      ]}
    >
      <Text style={[estilos.numero, !dia.delMes && estilos.numeroDeOtroMes, esHoy && estilos.numeroHoy]}>
        {dia.numero}
      </Text>
      {cuenta > 0 ? (
        <View style={[estilos.marca, { backgroundColor: tono.color }]}>
          <Text style={estilos.marcaTexto}>{cuenta}</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

/**
 * El calendario de la Matriz (US-019, CA-7), como `CalendarioMatriz.jsx`: el
 * mes de `GET matriz/calendario/`, con los días contados en la zona horaria
 * de la empresa. Se pasa al mes anterior y al siguiente; tocar un día con
 * obligaciones abre su lista. La cuadrícula es de `View` (sin dependencias
 * nativas): 7 columnas, de domingo a sábado.
 */
export function CalendarioMatriz({ matriz, onAbrirDia }) {
  const zona = matriz.zona;
  const hoy = diaEnZona(new Date(), zona);
  const [mes, setMes] = useState(() => {
    const [a, m] = hoy.split("-");
    return { anio: Number(a), mes: Number(m) };
  });
  const [carga, setCarga] = useState({ estado: "cargando", periodos: [], error: null, aviso: null });
  // Pedido del usuario (ronda 1): en el teléfono las casillas del mes
  // siguiente se salían del borde derecho. El ancho de cada día se calcula
  // con el de la cuadrícula medido, entero, y la tarjeta recorta lo demás.
  const [anchoDia, setAnchoDia] = useState(null);
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

  const cargar = useCallback(
    async ({ silenciosa = false } = {}) => {
      const numero = ++consulta.current;
      if (!silenciosa) setCarga({ estado: "cargando", periodos: [], error: null, aviso: null });
      try {
        const datos = await matrizService.calendario(mes.anio, mes.mes);
        if (!montado.current || numero !== consulta.current) return;
        setCarga({
          estado: "listo",
          periodos: Array.isArray(datos?.periods) ? datos.periods : [],
          error: null,
          aviso: null,
        });
      } catch (e) {
        if (!montado.current || numero !== consulta.current) return;
        const sinRol = e?.response?.status === 404;
        // H-06: un refresco fallido se dice, sin borrar lo que se ve.
        if (silenciosa && cargaRef.current.estado === "listo" && !sinRol) {
          setCarga((c) => ({
            ...c,
            aviso: `${mensajeDeMatriz(e, "No se pudo actualizar el calendario.")} Se muestra el anterior.`,
          }));
          return;
        }
        setCarga({
          estado: sinRol ? "sin_rol" : "error",
          periodos: [],
          error: sinRol ? TEXTO_SIN_ROL : mensajeDeMatriz(e, "No se pudo cargar el calendario."),
          aviso: null,
        });
      }
    },
    [mes],
  );

  useEffect(() => {
    if (lista) cargar();
  }, [lista, matriz.empresa, cargar]);

  // H-05: el efecto de foco no depende de `cargar` (cambia con el mes); si
  // dependiera, al cambiar de mes se pedía dos veces.
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;
  const primeraVez = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeraVez.current) {
        primeraVez.current = false;
        return;
      }
      if (cargaRef.current.estado === "listo") cargarRef.current({ silenciosa: true });
    }, []),
  );

  const porDia = useMemo(() => {
    const mapa = {};
    for (const periodo of carga.periodos) {
      const dia = diaEnZona(periodo.vence_en, zona);
      (mapa[dia] ??= []).push(periodo);
    }
    return mapa;
  }, [carga.periodos, zona]);

  const titulo = tituloDelMes(mes.anio, mes.mes);

  function mover(delta) {
    const siguiente = moverMes(mes, delta);
    setMes(siguiente);
    anunciarMes(tituloDelMes(siguiente.anio, siguiente.mes));
  }

  function irAHoy() {
    const [a, m] = hoy.split("-");
    setMes({ anio: Number(a), mes: Number(m) });
    anunciarMes(tituloDelMes(Number(a), Number(m)));
  }

  async function refrescar() {
    setRefrescando(true);
    await cargar({ silenciosa: cargaRef.current.estado === "listo" });
    if (montado.current) setRefrescando(false);
  }

  if (matriz.estado === "cargando") return <Cargando texto="Cargando la Matriz…" />;
  if (matriz.estado === "sin_rol") {
    return (
      <View style={estilos.contenido}>
        <SinRolMatriz />
      </View>
    );
  }
  if (matriz.estado === "error") {
    return (
      <View style={estilos.contenido}>
        <ErrorConReintento
          texto={mensajeDeMatriz(matriz.error, "No se pudo cargar la Matriz.")}
          onReintentar={matriz.recargar}
        />
      </View>
    );
  }

  const semanas = semanasDelMes(mes.anio, mes.mes);
  const delMes = carga.periodos.length;

  return (
    <ScrollView
      testID="calendario-matriz"
      style={estilos.lista}
      contentContainerStyle={estilos.contenido}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
    >
      <View style={estilos.navegacion}>
        <BotonIcono
          testID="mes-anterior"
          icono="chevron-left"
          etiqueta="Mes anterior"
          variante="contorno"
          onPress={() => mover(-1)}
        />
        <Text style={estilos.mes} accessibilityRole="header" accessibilityLiveRegion="polite" testID="titulo-del-mes">
          {titulo}
        </Text>
        <BotonIcono
          testID="mes-siguiente"
          icono="chevron-right"
          etiqueta="Mes siguiente"
          variante="contorno"
          onPress={() => mover(1)}
        />
      </View>
      <View style={estilos.fila}>
        <Text style={estilos.tenue}>
          {[carga.estado === "listo" ? `${cuantas(delMes)} este mes` : null, horaDeLaZona(zona)]
            .filter(Boolean)
            .join(" · ") || " "}
        </Text>
        <Boton testID="ir-a-hoy" titulo="Hoy" icono="calendar-today" variante="secundario" onPress={irAHoy} />
      </View>

      {carga.aviso ? <Alerta tipo="mal" texto={carga.aviso} testID="aviso-calendario" /> : null}
      {carga.estado === "sin_rol" ? <SinRolMatriz /> : null}
      {/* H-04: con un error no se pintan días que dirían «sin obligaciones». */}
      {carga.estado === "error" ? <ErrorConReintento texto={carga.error} onReintentar={() => cargar()} /> : null}

      {carga.estado === "error" || carga.estado === "sin_rol" ? null : (
        <View
          style={estilos.cuadricula}
          testID="cuadricula"
          accessibilityLabel={`Calendario de ${titulo}`}
          onLayout={(e) => {
            // Lo de dentro del borde de 1 dp, en enteros: 7 casillas iguales.
            const ancho = Math.floor((e.nativeEvent.layout.width - 2) / 7);
            if (ancho > 0 && ancho !== anchoDia) setAnchoDia(ancho);
          }}
        >
          <View style={estilos.semana} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {DIAS_SEMANA.map((d) => (
              <Text key={d.corto} style={[estilos.diaSemana, anchoDia ? { width: anchoDia, flex: 0 } : null]}>
                {d.corto}
              </Text>
            ))}
          </View>
          {carga.estado === "cargando" ? (
            <Cargando texto="Cargando el calendario…" />
          ) : (
            semanas.map((semana) => (
              <View key={semana[0].iso} style={estilos.semana}>
                {semana.map((dia) => (
                  <Dia
                    key={dia.iso}
                    dia={dia}
                    lista={porDia[dia.iso] ?? SIN_PERIODOS}
                    hoy={hoy}
                    onAbrir={onAbrirDia}
                    ancho={anchoDia}
                  />
                ))}
              </View>
            ))
          )}
        </View>
      )}

      <View style={estilos.leyenda} testID="leyenda">
        {[
          ["incumplido", "Incumplido"],
          ["en_progreso", "En progreso"],
          ["finalizado", "Finalizado"],
        ].map(([grupo, texto]) => (
          <View key={grupo} style={estilos.leyendaElemento}>
            <View style={[estilos.leyendaMarca, { backgroundColor: tonoDeGrupo(grupo).color }]} />
            <Text style={estilos.tenue}>{texto}</Text>
          </View>
        ))}
        <Text style={estilos.tenue}>El número dice cuántas vencen ese día; el color, la más urgente.</Text>
      </View>
    </ScrollView>
  );
}

const estilos = crearEstilos({
  lista: { flex: 1 },
  // 4 a los lados y los días sin margen: 7 columnas de 50 dp en 360 dp
  // ((360 − 8 − 2) / 7, medido con `onLayout`), por encima de los 48 dp de
  // área táctil de Android.
  contenido: { paddingHorizontal: 4, paddingTop: 8, paddingBottom: 32, gap: 12 },
  navegacion: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 },
  mes: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "700", color: colores.titulo },
  fila: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 8,
  },
  tenue: { flexShrink: 1, fontSize: 14, color: colores.tintaSuave },
  cuadricula: {
    backgroundColor: colores.superficie,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colores.borde,
    paddingVertical: 4,
    overflow: "hidden",
  },
  semana: { flexDirection: "row", justifyContent: "center" },
  diaSemana: {
    flex: 1,
    minWidth: 0,
    textAlign: "center",
    paddingVertical: 6,
    fontSize: 13,
    fontWeight: "600",
    color: colores.tintaSuave,
  },
  dia: {
    flex: 1,
    minWidth: 0,
    minHeight: AREA_TACTIL + 8,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingVertical: 4,
    gap: 2,
    borderRadius: 8,
  },
  diaDeOtroMes: { backgroundColor: colores.fondo },
  hoy: { borderWidth: 2, borderColor: colores.primario },
  presionada: { backgroundColor: colores.realce },
  numero: { fontSize: 15, color: colores.tinta },
  numeroDeOtroMes: { color: colores.tintaTenue },
  numeroHoy: { fontWeight: "700" },
  marca: { minWidth: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: "center" },
  marcaTexto: { fontSize: 12, fontWeight: "700", color: colores.sobrePrimario },
  leyenda: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, paddingHorizontal: 8 },
  leyendaElemento: { flexDirection: "row", alignItems: "center", gap: 6 },
  leyendaMarca: { width: 14, height: 14, borderRadius: 7 },
});
