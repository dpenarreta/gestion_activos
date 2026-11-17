import { useFocusEffect, usePathname, useRouter } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { useTecladoAbierto } from "../accesibilidad/teclado";
import { BotonFlotante, ESPACIO_BOTON_FLOTANTE } from "../componentes/BotonFlotante";
import { useSesion } from "../sesion/SesionContext";
import { useResumenSoporte } from "../soporte/ResumenSoporteContext";
import { distanciaAlBorde, muestraLaBurbuja, RUTA_DEL_TICKET_PROPIO } from "./reglasDeLaBurbuja";

/**
 * La burbuja de soporte (US-029, 17/11/2026): un botón flotante, igual que el
 * de «Escanear» de Gestión de Activos, que abre «Nuevo ticket» desde
 * cualquier pantalla. Se monta UNA vez, en el layout autenticado
 * (`app/(app)/_layout.js`), después de la pila: así queda encima de todas las
 * pantallas y, para el lector de pantalla, después de su contenido (CA-5).
 * Las reglas (dónde, quién y a qué altura) están en `reglasDeLaBurbuja.js`.
 *
 * Para no superponerse con lo que cada pantalla tiene abajo a la derecha
 * (CA-3), la burbuja se APILA encima:
 * - la barra de funcionalidades publica su alto (`useInformarAlturaDeLaBarra`);
 * - la pantalla con foco que tiene algo fijo abajo (la burbuja de «Nuevo
 *   mensaje» del chat, la fila de escribir de la conversación, el pie de
 *   «Nuevo grupo») lo publica con `useApoyoDeLaBurbuja`. Al perder el foco
 *   lo retira, así que solo cuenta la pantalla que se ve.
 *
 * Y para que no tape lo último de una lista o el botón final de un
 * formulario, las pantallas dejan ese espacio al final mientras la burbuja
 * se ve (`useRellenoDeLaBurbuja`).
 *
 * Tres contextos (QA-TECH, P2): `VisibleContext` (un booleano, lo leen las
 * ~27 pantallas con relleno), `PosicionContext` (alto de la barra y apoyo,
 * solo para la burbuja) y `AccionesContext` (estable). Medir la barra o una
 * fila de escribir mueve la burbuja sin volver a pintar las pantallas.
 */

/** El margen inferior del sistema. Leído del contexto y no con
 * `useSafeAreaInsets`: una pantalla suelta (sin `SafeAreaProvider`, como en
 * las pruebas) no se rompe por la burbuja; queda en 0. */
const SIN_MARGENES = createContext(null);
function useMargenInferior() {
  const margenes = useContext(SafeAreaInsetsContext ?? SIN_MARGENES);
  return Math.max(0, Number(margenes?.bottom) || 0);
}
const VisibleContext = createContext(false);
const PosicionContext = createContext({ alturaBarra: null, apoyo: 0 });
const AccionesContext = createContext({ fijarBarra: () => {}, fijarApoyo: () => {} });

export function ProveedorDeLaBurbuja({ children }) {
  const ruta = usePathname();
  const { usuario } = useSesion();
  const { moduloApagado } = useResumenSoporte();
  // Sin el teclado: el espacio al final de las listas no salta al escribir.
  const visible = muestraLaBurbuja({ ruta, permisos: usuario?.permissions, moduloApagado, teclado: false });
  const [alturaBarra, setAlturaBarra] = useState(null);
  const [apoyos, setApoyos] = useState({});

  const fijarBarra = useCallback((alto) => {
    const valor = Math.max(0, Math.round(Number(alto) || 0));
    setAlturaBarra((actual) => (actual === valor ? actual : valor));
  }, []);

  /** `alto` null retira el apoyo de esa pantalla. */
  const fijarApoyo = useCallback((clave, alto) => {
    setApoyos((actual) => {
      if (alto == null) {
        if (!(clave in actual)) return actual;
        const { [clave]: _quitado, ...resto } = actual;
        return resto;
      }
      const valor = Math.max(0, Math.round(Number(alto) || 0));
      return actual[clave] === valor ? actual : { ...actual, [clave]: valor };
    });
  }, []);

  const apoyo = Math.max(0, ...Object.values(apoyos));
  const posicion = useMemo(() => ({ alturaBarra, apoyo }), [alturaBarra, apoyo]);
  const acciones = useMemo(() => ({ fijarBarra, fijarApoyo }), [fijarBarra, fijarApoyo]);
  return (
    <AccionesContext.Provider value={acciones}>
      <VisibleContext.Provider value={visible}>
        <PosicionContext.Provider value={posicion}>{children}</PosicionContext.Provider>
      </VisibleContext.Provider>
    </AccionesContext.Provider>
  );
}

/** Para la barra de funcionalidades: un `onLayout` que publica su alto, y
 * `ocultar()` cuando no tiene funcionalidades (con el teclado no: la burbuja
 * también se aparta y, al cerrarlo, la barra vuelve con el mismo alto). */
export function useInformarAlturaDeLaBarra() {
  const { fijarBarra } = useContext(AccionesContext);
  const alMedir = useCallback((evento) => fijarBarra(evento?.nativeEvent?.layout?.height), [fijarBarra]);
  const ocultar = useCallback(() => fijarBarra(0), [fijarBarra]);
  return { alMedir, ocultar };
}

let siguienteClave = 0;

/**
 * Para una pantalla con algo fijo abajo a la derecha: publica cuánto ocupa
 * desde el borde inferior mientras tiene el foco.
 * - Con `altoFijo` (un número), ese.
 * - Sin él, lo que mida la vista a la que se le pone el `onLayout` devuelto,
 *   más `extra` (por ejemplo, el botón «Ir al último» sobre la fila de
 *   escribir).
 */
export function useApoyoDeLaBurbuja({ altoFijo, extra = 0 } = {}) {
  const { fijarApoyo } = useContext(AccionesContext);
  const clave = useRef(null);
  if (clave.current === null) clave.current = `apoyo-${(siguienteClave += 1)}`;
  const [medido, setMedido] = useState(0);
  const alto = typeof altoFijo === "number" ? altoFijo : medido > 0 ? medido + extra : 0;

  useFocusEffect(
    useCallback(() => {
      const id = clave.current;
      fijarApoyo(id, alto);
      return () => fijarApoyo(id, null);
    }, [fijarApoyo, alto]),
  );

  return useCallback((evento) => {
    const h = Math.round(Number(evento?.nativeEvent?.layout?.height) || 0);
    setMedido((actual) => (actual === h ? actual : h));
  }, []);
}

/**
 * El espacio que una pantalla deja al final de su lista o formulario para
 * que la burbuja no tape lo último (CA-3): `{ paddingBottom }` mientras la
 * burbuja se ve, o `null`. `margenDelSistema`: si la lista llega hasta el
 * borde de la pantalla (fichas y formularios de la pila) suma el margen del
 * sistema; las de las pestañas acaban sobre la barra y la de una
 * conversación sobre la fila de escribir (`false`). `extra`: lo que la
 * pantalla ya tenía debajo de la burbuja (otra burbuja).
 */
export function useRellenoDeLaBurbuja({ margenDelSistema = true, extra = 0 } = {}) {
  const visible = useContext(VisibleContext);
  const margenInferior = useMargenInferior();
  const sistema = margenDelSistema ? margenInferior : 0;
  return useMemo(
    () => (visible ? { paddingBottom: ESPACIO_BOTON_FLOTANTE + extra + sistema } : null),
    [visible, extra, sistema],
  );
}

/** El tiempo en que un segundo toque no abre otro formulario encima. */
export const CANDADO_BURBUJA_MS = 800;

export function BurbujaDeSoporte() {
  const ruta = usePathname();
  const router = useRouter();
  const teclado = useTecladoAbierto();
  const visible = useContext(VisibleContext);
  const { alturaBarra, apoyo } = useContext(PosicionContext);
  const margenInferior = useMargenInferior();
  const abriendo = useRef(false);
  const temporizador = useRef(null);

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  // Con el teclado abierto se aparta: no tapa el campo de escribir (CA-3).
  if (!visible || teclado) return null;

  function abrir() {
    // Un toque doble no apila dos formularios (como «Nuevo mensaje»).
    if (abriendo.current) return;
    abriendo.current = true;
    router.push(RUTA_DEL_TICKET_PROPIO);
    temporizador.current = setTimeout(() => {
      abriendo.current = false;
      temporizador.current = null;
    }, CANDADO_BURBUJA_MS);
  }

  const bottom = distanciaAlBorde({ ruta, alturaBarra, apoyo, margenSistema: margenInferior });
  return (
    // La capa no recibe toques: solo la burbuja.
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="capa-burbuja-soporte">
      <BotonFlotante
        testID="burbuja-soporte"
        icono="headset"
        etiqueta="Crear un ticket de soporte"
        pista="Abre el formulario para pedir ayuda a la Mesa de ayuda"
        onPress={abrir}
        estilo={{ bottom }}
      />
    </View>
  );
}
