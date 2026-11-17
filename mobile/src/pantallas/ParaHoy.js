import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { notificacionesService } from "../api/servicios";
import { Cargando, ErrorConReintento } from "../componentes/comunes";
import { Icono } from "../componentes/Icono";
import { estaLeida, iconoDe } from "../notificaciones/abrir";
import { abrirNotificacion } from "../notificaciones/abrirNotificacion";
import { coloresDe } from "../notificaciones/coloresDeModulo";
import { useContador } from "../notificaciones/ContadorContext";
import { AREA_TACTIL } from "../tema/colores";
import { useApariencia, useEstilos } from "../tema/apariencia";
import { crearEstilos } from "../tema/tipografia";
import { haceCuantoLlego } from "../utils/fechas";

/**
 * «Para hoy» del Inicio (US-027, decisión del usuario del 17/11/2026): abre
 * contraído, con cuántos avisos sin leer tiene la persona en la campana, y al
 * expandirse muestra cada uno (módulo, título y resumen), los más recientes
 * primero y hasta `MAXIMO_PARA_HOY`. Reemplaza las líneas agrupadas de antes
 * (tickets, solicitudes por aprobar, mensajes y avisos de otros módulos): lo
 * pendiente que avisa en la campana sigue llegando, ahora como aviso.
 *
 * Usa los mismos servicios que la campana (la lista de no leídas y el
 * contador), sin endpoints nuevos. Se carga al enfocar el Inicio (también al
 * volver de un aviso), al deslizar para actualizar (`recarga`), al cambiar de
 * empresa (`version`) y cuando el contador de la campana cambia por su cuenta
 * (un push, la vuelta al frente).
 */
export const MAXIMO_PARA_HOY = 10;

const SIN_DATOS = { estado: "cargando", avisos: [], total: 0, fallo: false };

export function textoAvisosPorRevisar(cantidad) {
  return cantidad === 1
    ? "1 aviso por revisar"
    : `${cantidad} avisos por revisar`;
}

export const TEXTO_ERROR_PARA_HOY = "No se pudieron cargar los avisos.";
export const TEXTO_ERROR_ACTUALIZAR_PARA_HOY =
  "No se pudieron actualizar los avisos. Se muestran los anteriores.";

/** Los avisos sin leer, del más reciente al más antiguo, hasta el máximo. */
export function avisosParaHoy(lista) {
  return (Array.isArray(lista) ? lista : [])
    .filter((n) => !estaLeida(n))
    .map((n, i) => ({ n, i, t: new Date(n.created_at).getTime() || 0 }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .slice(0, MAXIMO_PARA_HOY)
    .map(({ n }) => n);
}

/** El nombre que dice el lector de pantalla: «Módulo. Título. Resumen». */
export function etiquetaDeAviso(notificacion) {
  return [notificacion.modulo_nombre, notificacion.titulo, notificacion.resumen]
    .filter(Boolean)
    .join(". ");
}

export function ParaHoy({ recarga = 0, version, mapa }) {
  const { colores } = useApariencia();
  const estilos = useEstilos(fabricaDeEstilos);
  const router = useRouter();
  const { noLeidas = 0, recargar: recargarContador } = useContador();
  // `fallo`: la última carga salió mal. Con avisos ya a la vista se
  // conservan y se dice dentro del bloque.
  const [datos, setDatos] = useState(SIN_DATOS);
  // No se guarda: el bloque siempre abre contraído (US-027).
  const [abierto, setAbierto] = useState(false);
  const montado = useRef(true);
  // Cada carga lleva un número: solo se pinta la última.
  const consulta = useRef(0);
  // Cuántas cargas siguen en vuelo (QA, 17/11/2026): el cambio del contador
  // no pide otra mientras tanto.
  const enVuelo = useRef(0);
  const datosRef = useRef(datos);
  datosRef.current = datos;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(async () => {
    const numero = ++consulta.current;
    enVuelo.current += 1;
    try {
      // Solo los que se muestran (QA, 17/11/2026); el total sale de `count`.
      const respuesta = await notificacionesService.listar({
        pagina: 1,
        soloNoLeidas: true,
        tamano: MAXIMO_PARA_HOY,
      });
      if (!montado.current || numero !== consulta.current) return;
      const resultados = Array.isArray(respuesta?.results)
        ? respuesta.results
        : [];
      const sinLeer = resultados.filter((n) => !estaLeida(n));
      // `count` es el total de no leídas (puede haber más páginas).
      const total =
        typeof respuesta?.count === "number"
          ? Math.max(respuesta.count, sinLeer.length)
          : sinLeer.length;
      setDatos({
        estado: "listo",
        avisos: avisosParaHoy(sinLeer),
        total,
        fallo: false,
      });
    } catch {
      if (!montado.current || numero !== consulta.current) return;
      setDatos((d) =>
        d.estado === "listo"
          ? { ...d, fallo: true }
          : { estado: "error", avisos: [], total: 0, fallo: true },
      );
    } finally {
      enVuelo.current -= 1;
    }
  }, []);

  // Al entrar y cada vez que el Inicio vuelve a tener el foco.
  useFocusEffect(
    useCallback(() => {
      cargar();
    }, [cargar]),
  );

  // Al deslizar para actualizar y al cambiar de empresa (la primera vez ya
  // cargó el foco).
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    cargar();
  }, [cargar, recarga]);

  // Al cambiar de empresa (QA O-2, 17/11/2026), primero se vacía, como
  // `ListaNotificaciones.js`: si la recarga falla, no quedan a la vista los
  // avisos de la empresa anterior.
  const versionPrevia = useRef(version);
  useEffect(() => {
    if (versionPrevia.current === version) return;
    versionPrevia.current = version;
    setDatos(SIN_DATOS);
    cargar();
  }, [cargar, version]);

  // Si el contador de la campana cambió por su cuenta y ya no coincide. No
  // se repite si ya hay una carga en vuelo (al cambiar de empresa cambian
  // los dos a la vez).
  useEffect(() => {
    const actual = datosRef.current;
    if (enVuelo.current > 0) return;
    if (actual.estado === "listo" && noLeidas !== actual.total) cargar();
  }, [noLeidas, cargar]);

  function abrir(notificacion) {
    abrirNotificacion({
      notificacion,
      router,
      mapa,
      recargarContador,
      // Sale de la lista enseguida; al volver se recarga igual. Lo que
      // estaba en vuelo ya no se pinta: traería el aviso todavía sin leer.
      alMarcarLeida: () => {
        consulta.current += 1;
        setDatos((d) => {
          const avisos = d.avisos.filter((n) => n.id !== notificacion.id);
          const quitados = d.avisos.length - avisos.length;
          return { ...d, avisos, total: Math.max(0, d.total - quitados) };
        });
      },
    });
  }

  // Mientras llega la primera carga se usa el contador de la campana, para
  // que el encabezado no aparezca de golpe ni cambie al llegar la lista.
  const total = datos.estado === "listo" ? datos.total : noLeidas;
  if (total === 0) {
    // QA O-1: con el contador todavía en 0 y la lista sin llegar, se reserva
    // el alto del encabezado; si al final no hay avisos, desaparece.
    if (datos.estado === "cargando") return <EspacioReservado />;
    // CA-2 (QA, 17/11/2026): sin avisos en la campana y la carga fallida no
    // se muestra nada: el Inicio no da un error por algo que quizá no existe.
    return null;
  }

  const resumen = textoAvisosPorRevisar(total);

  return (
    <View style={estilos.bloque} testID="para-hoy">
      <Pressable
        testID="para-hoy-encabezado"
        onPress={() => setAbierto((a) => !a)}
        accessibilityRole="button"
        accessibilityLabel={`Para hoy. ${resumen}`}
        accessibilityHint={
          abierto ? "Contrae la lista de avisos" : "Muestra la lista de avisos"
        }
        accessibilityState={{ expanded: abierto }}
        style={({ pressed }) => [
          estilos.encabezado,
          pressed && estilos.presionado,
        ]}
      >
        <View style={estilos.encabezadoTexto}>
          <Text style={estilos.titulo}>Para hoy</Text>
          <Text style={estilos.resumenBloque} testID="para-hoy-resumen">
            {resumen}
          </Text>
        </View>
        <Icono
          nombre={abierto ? "chevron-up" : "chevron-down"}
          size={26}
          color={colores.tinta}
        />
      </Pressable>

      {abierto ? (
        <View style={estilos.cuerpo} testID="para-hoy-lista">
          {datos.estado === "cargando" ? (
            <Cargando texto="Cargando avisos…" />
          ) : datos.estado === "error" ? (
            <ErrorConReintento
              texto={TEXTO_ERROR_PARA_HOY}
              onReintentar={cargar}
            />
          ) : (
            <>
              {datos.fallo ? (
                <ErrorConReintento
                  texto={TEXTO_ERROR_ACTUALIZAR_PARA_HOY}
                  onReintentar={cargar}
                />
              ) : null}
              {datos.avisos.map((n) => (
                <FilaDeAviso key={n.id} notificacion={n} onAbrir={abrir} />
              ))}
              <Pressable
                testID="para-hoy-ver-todos"
                onPress={() => router.push("/notificaciones")}
                accessibilityRole="button"
                accessibilityLabel="Ver todos los avisos"
                style={({ pressed }) => [
                  estilos.verTodos,
                  pressed && estilos.presionado,
                ]}
              >
                <Text style={estilos.verTodosTexto}>Ver todos los avisos</Text>
                <Icono
                  nombre="chevron-right"
                  size={22}
                  color={colores.tinta}
                />
              </Pressable>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

/** El alto del encabezado, invisible y fuera del lector de pantalla:
 * mismos textos y estilos, así crece igual con la letra grande. */
function EspacioReservado() {
  const estilos = useEstilos(fabricaDeEstilos);
  return (
    <View
      testID="para-hoy-reservado"
      style={[estilos.bloque, estilos.reservado]}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <View style={estilos.encabezado}>
        <View style={estilos.encabezadoTexto}>
          <Text style={estilos.titulo}>Para hoy</Text>
          <Text style={estilos.resumenBloque}> </Text>
        </View>
      </View>
    </View>
  );
}

/** Una fila: el ícono y la etiqueta del módulo con su color (como en la
 * campana), hace cuánto llegó, el título y el resumen. */
function FilaDeAviso({ notificacion, onAbrir }) {
  const { colores, oscuro } = useApariencia();
  const estilos = useEstilos(fabricaDeEstilos);
  const color = coloresDe(notificacion, oscuro);
  const fecha = haceCuantoLlego(notificacion.created_at);
  return (
    <Pressable
      testID={`para-hoy-aviso-${notificacion.id}`}
      onPress={() => onAbrir(notificacion)}
      accessibilityRole="button"
      accessibilityLabel={etiquetaDeAviso(notificacion)}
      accessibilityHint="Abre el aviso"
      style={({ pressed }) => [estilos.fila, pressed && estilos.presionado]}
    >
      <View style={[estilos.icono, { backgroundColor: color.fondo }]}>
        <Icono bootstrap={iconoDe(notificacion)} size={20} color={color.icono} />
      </View>
      <View style={estilos.textos}>
        <View style={estilos.filaSuperior}>
          {notificacion.modulo_nombre ? (
            <View style={[estilos.etiqueta, { backgroundColor: color.etiqueta }]}>
              <Text
                style={[estilos.etiquetaTexto, { color: color.sobreEtiqueta }]}
              >
                {notificacion.modulo_nombre}
              </Text>
            </View>
          ) : null}
          {fecha ? (
            <Text
              style={estilos.fecha}
              testID={`para-hoy-llego-${notificacion.id}`}
            >
              {fecha}
            </Text>
          ) : null}
        </View>
        <Text style={estilos.tituloAviso} numberOfLines={2}>
          {notificacion.titulo}
        </Text>
        {notificacion.resumen ? (
          <Text style={estilos.resumenAviso} numberOfLines={2}>
            {notificacion.resumen}
          </Text>
        ) : null}
      </View>
      <Icono nombre="chevron-right" size={22} color={colores.tintaTenue} />
    </Pressable>
  );
}

const fabricaDeEstilos = (colores) =>
  crearEstilos({
    bloque: {
      borderRadius: 10,
      backgroundColor: colores.superficie,
      borderLeftWidth: 4,
      borderLeftColor: colores.acento,
      overflow: "hidden",
    },
    reservado: { opacity: 0 },
    encabezado: {
      minHeight: AREA_TACTIL,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    encabezadoTexto: { flex: 1, gap: 2 },
    titulo: { fontSize: 18, fontWeight: "700", color: colores.tinta },
    resumenBloque: { fontSize: 15, color: colores.tintaSuave },
    presionado: { backgroundColor: colores.realce },
    cuerpo: {
      borderTopWidth: 1,
      borderTopColor: colores.borde,
      paddingVertical: 4,
      gap: 2,
    },
    fila: {
      minHeight: AREA_TACTIL,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    icono: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    textos: { flex: 1, gap: 2 },
    filaSuperior: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      columnGap: 8,
    },
    etiqueta: {
      flexShrink: 1,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 6,
    },
    etiquetaTexto: { fontSize: 12, fontWeight: "600" },
    fecha: { fontSize: 13, color: colores.tintaTenue, flexShrink: 1 },
    tituloAviso: { fontSize: 16, fontWeight: "700", color: colores.tinta },
    resumenAviso: { fontSize: 14, color: colores.tintaSuave },
    verTodos: {
      minHeight: AREA_TACTIL,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      paddingHorizontal: 12,
      borderTopWidth: 1,
      borderTopColor: colores.borde,
    },
    verTodosTexto: {
      fontSize: 16,
      fontWeight: "600",
      color: colores.tinta,
      textDecorationLine: "underline",
    },
  });
