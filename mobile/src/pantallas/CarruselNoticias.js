import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, FlatList, Image, Platform, Pressable, Text, View } from "react-native";

import { anunciar } from "../accesibilidad/anunciar";
import { api } from "../api/api";
import { inicioService } from "../api/servicios";
import { Icono } from "../componentes/Icono";
import { AREA_TACTIL, colores } from "../tema/colores";
import { crearEstilos } from "../tema/tipografia";

/** Lo mínimo que se deja una noticia antes de pasar (igual que la web). */
const SEGUNDOS_MINIMOS = 5;

export function textoPosicion(indice, total) {
  return `Noticia ${indice + 1} de ${total}`;
}

/** Si el sistema pide que nada se mueva solo: menos movimiento o lector de
 * pantalla activo. Escucha los cambios mientras la app está abierta. */
function useSistemaDetieneElCarrusel() {
  const [preferencias, setPreferencias] = useState({ menosMovimiento: false, lector: false });

  useEffect(() => {
    let vigente = true;
    Promise.all([
      AccessibilityInfo.isReduceMotionEnabled?.() ?? false,
      AccessibilityInfo.isScreenReaderEnabled?.() ?? false,
    ])
      .then(([menosMovimiento, lector]) => {
        if (vigente) setPreferencias({ menosMovimiento: Boolean(menosMovimiento), lector: Boolean(lector) });
      })
      .catch(() => {});
    const movimiento = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (valor) =>
      setPreferencias((p) => ({ ...p, menosMovimiento: Boolean(valor) })),
    );
    const lector = AccessibilityInfo.addEventListener?.("screenReaderChanged", (valor) =>
      setPreferencias((p) => ({ ...p, lector: Boolean(valor) })),
    );
    return () => {
      vigente = false;
      movimiento?.remove?.();
      lector?.remove?.();
    };
  }, []);

  return preferencias.menosMovimiento || preferencias.lector;
}

/**
 * Las noticias vigentes del carrusel de Inicio. Las imágenes no tienen URL
 * pública (la web las pide como blob con el token): aquí se piden con las
 * mismas cabeceras de autorización, que `<Image>` admite en Android e iOS. Se
 * muestran completas (`contain`) en un marco 16:10, como en la web.
 *
 * WCAG 2.2.2 (revisión de QA-UX, 12/11/2026): pasa sola cada `segundos`, pero
 * se puede pausar con un botón visible; tocar las flechas o deslizar a mano
 * también la pausa. No se mueve sola si el sistema pide menos movimiento o hay
 * un lector de pantalla activo.
 */
export function CarruselNoticias({ noticias, segundos }) {
  const [ancho, setAncho] = useState(0);
  const [indice, setIndice] = useState(0);
  const [pausado, setPausado] = useState(false);
  const [fallidas, setFallidas] = useState({});
  const sistemaDetiene = useSistemaDetieneElCarrusel();
  const lista = useRef(null);
  const total = noticias.length;
  const automatico = !sistemaDetiene && !pausado && total > 1 && ancho > 0;

  const irA = useCallback(
    (i, { animado = true } = {}) => {
      setIndice(i);
      lista.current?.scrollToOffset?.({ offset: i * ancho, animated: animado });
    },
    [ancho],
  );

  // Otras noticias (al refrescar o cambiar de empresa): se vuelve a la
  // primera y se olvidan las imágenes que fallaron.
  const clave = noticias.map((n) => n.id).join(",");
  useEffect(() => {
    setFallidas({});
    irA(0, { animado: false });
    // Solo cuando cambian las noticias, no cuando cambia el ancho.
  }, [clave]);

  useEffect(() => {
    if (!automatico) return undefined;
    const espera = Math.max(SEGUNDOS_MINIMOS, segundos) * 1000;
    const temporizador = setTimeout(() => irA((indice + 1) % total), espera);
    return () => clearTimeout(temporizador);
  }, [automatico, indice, total, segundos, irA]);

  /** Lo que hace la persona: pausa el carrusel y, en iOS, anuncia la
   * posición (Android la lee por la región viva del texto). */
  function moverAMano(i) {
    setPausado(true);
    irA(i);
    if (Platform.OS === "ios") anunciar(textoPosicion(i, total));
  }

  const cabeceras = api.cabecerasDeAutorizacion();
  const actual = noticias[Math.min(indice, total - 1)];
  const alto = (ancho * 10) / 16;

  return (
    <View
      testID="carrusel-noticias"
      onLayout={(e) => setAncho(e.nativeEvent.layout.width)}
      style={estilos.marco}
    >
      {ancho > 0 && (
        <FlatList
          ref={lista}
          data={noticias}
          keyExtractor={(n) => String(n.id)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScrollBeginDrag={() => setPausado(true)}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / ancho);
            if (i !== indice) {
              setIndice(i);
              if (Platform.OS === "ios") anunciar(textoPosicion(i, total));
            }
          }}
          getItemLayout={(_, i) => ({ length: ancho, offset: ancho * i, index: i })}
          // Sin esto la lista no se vuelve a pintar al cambiar de noticia y
          // las diapositivas no actualizan quién es la visible.
          extraData={indice}
          renderItem={({ item, index }) => {
            // Solo la diapositiva visible existe para el lector de pantalla:
            // las otras están fuera del marco y leerlas confunde (auditoría
            // de QA-UX, 12/11/2026).
            const oculta = index !== indice;
            const accesibilidad = {
              accessibilityElementsHidden: oculta,
              importantForAccessibility: oculta ? "no-hide-descendants" : "auto",
            };
            return fallidas[item.id] ? (
              <View
                testID={`diapositiva-${item.id}`}
                style={[estilos.sinImagen, { width: ancho, height: alto }]}
                {...accesibilidad}
              >
                <View
                  accessible
                  accessibilityLabel="No se pudo cargar la imagen de esta noticia."
                  style={estilos.sinImagenContenido}
                >
                  <Icono nombre="image-off-outline" size={36} color={colores.tintaTenue} />
                  <Text style={estilos.sinImagenTexto}>No se pudo cargar la imagen.</Text>
                </View>
              </View>
            ) : (
              <View testID={`diapositiva-${item.id}`} style={{ width: ancho }} {...accesibilidad}>
                <Image
                  testID={`imagen-noticia-${item.id}`}
                  source={{ uri: inicioService.rutaImagenNoticia(item.id), headers: cabeceras }}
                  style={[estilos.imagen, { height: alto }]}
                  resizeMode="contain"
                  onError={() => setFallidas((f) => ({ ...f, [item.id]: true }))}
                  accessible
                  accessibilityRole="image"
                  // El título se lee debajo: aquí solo lo que muestra la imagen.
                  accessibilityLabel={item.texto_alternativo || "Imagen de la noticia"}
                />
              </View>
            );
          }}
        />
      )}
      {actual && (actual.titulo || actual.descripcion) ? (
        <View style={estilos.texto}>
          {actual.titulo ? <Text style={estilos.titulo}>{actual.titulo}</Text> : null}
          {actual.descripcion ? <Text style={estilos.descripcion}>{actual.descripcion}</Text> : null}
        </View>
      ) : null}
      {total > 1 && (
        <View style={estilos.controles}>
          <Pressable
            onPress={() => moverAMano((indice - 1 + total) % total)}
            accessibilityRole="button"
            accessibilityLabel="Noticia anterior"
            style={estilos.control}
          >
            <Icono nombre="chevron-left" size={28} color={colores.primario} />
          </Pressable>
          <Text style={estilos.posicion} accessibilityLiveRegion="polite">
            {textoPosicion(indice, total)}
          </Text>
          {!sistemaDetiene && (
            <Pressable
              testID="pausar-carrusel"
              onPress={() => setPausado((p) => !p)}
              accessibilityRole="button"
              accessibilityLabel={pausado ? "Reanudar el carrusel" : "Pausar el carrusel"}
              style={estilos.control}
            >
              <Icono nombre={pausado ? "play" : "pause"} size={24} color={colores.primario} />
            </Pressable>
          )}
          <Pressable
            onPress={() => moverAMano((indice + 1) % total)}
            accessibilityRole="button"
            accessibilityLabel="Noticia siguiente"
            style={estilos.control}
          >
            <Icono nombre="chevron-right" size={28} color={colores.primario} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const estilos = crearEstilos({
  marco: {
    backgroundColor: colores.superficie,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colores.borde,
    overflow: "hidden",
  },
  imagen: { width: "100%", backgroundColor: colores.marcaNegro },
  sinImagen: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colores.hundido,
  },
  sinImagenContenido: { alignItems: "center", gap: 8 },
  sinImagenTexto: { fontSize: 14, color: colores.tintaSuave },
  texto: { padding: 12, gap: 4 },
  titulo: { fontSize: 16, fontWeight: "700", color: colores.tinta },
  descripcion: { fontSize: 14, color: colores.tintaSuave },
  controles: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  control: {
    minWidth: AREA_TACTIL,
    minHeight: AREA_TACTIL,
    alignItems: "center",
    justifyContent: "center",
  },
  posicion: { flex: 1, textAlign: "center", fontSize: 14, color: colores.tintaSuave },
});
