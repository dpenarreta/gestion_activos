import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { ordenesService } from "../../api/servicios";
import { useBusquedaConEspera, useListaPaginada } from "../../activos/useListaPaginada";
import { Icono } from "../../componentes/Icono";
import {
  cuantasOrdenes,
  ESPERA_BUSCAR_MS,
  mensajeDeOrdenes,
  nombreDePestana,
  parametrosDeMisOrdenes,
  PESTANAS,
  pestanaValida,
  textoDeListaVacia,
} from "../../ordenes/formato";
import { AREA_TACTIL } from "../../tema/colores";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { BuscadorDeLista, ListaPaginada } from "../activos/listas";
import { useMontado } from "../activos/piezas";
import { FilaOrden } from "./piezas";

/** Las dos pestañas con su contador (CA-7). La elegida lleva fondo negro y
 * ✓: no se distingue solo por el color. */
function Pestanas({ actual, cuentas, onCambio }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  return (
    <View style={estilos.pestanas} accessibilityRole="tablist" accessibilityLabel="Mis órdenes">
      {PESTANAS.map((p) => {
        const activa = p.clave === actual;
        const cuenta = cuentas[p.clave];
        return (
          <Pressable
            key={p.clave}
            testID={`pestana-${p.clave}`}
            onPress={() => onCambio(p.clave)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activa }}
            accessibilityLabel={nombreDePestana(p, cuenta)}
            style={({ pressed }) => [estilos.pestana, activa && estilos.pestanaActiva, pressed && !activa && estilos.presionada]}
          >
            {activa ? <Icono nombre="check" size={18} color={colores.sobrePrimario} /> : null}
            <Text style={[estilos.pestanaTexto, activa && estilos.pestanaTextoActiva]}>{p.texto}</Text>
            {cuenta !== null && cuenta !== undefined ? (
              <View style={[estilos.contador, activa && estilos.contadorActivo]} testID={`cuenta-${p.clave}`}>
                <Text style={[estilos.contadorTexto, activa && estilos.contadorTextoActivo]}>{cuenta}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Cuántas órdenes abiertas tiene cada pestaña. La activa la da su propia
 * lista (`onTotal`, sin búsqueda); aquí solo se cuenta la OTRA, con `count`
 * de una página de una fila (QA-TECH, 17/11/2026: no pedir dos veces lo
 * mismo). Si falla, su contador no se muestra.
 */
function useCuentas(pestana, empresa, versionEmpresa) {
  const [cuentas, setCuentas] = useState({ mias: null, asignadas: null });
  const montado = useMontado();
  const consulta = useRef(0);
  const pestanaRef = useRef(pestana);
  pestanaRef.current = pestana;

  const contar = useCallback(async () => {
    const numero = ++consulta.current;
    const otra = PESTANAS.find((p) => p.clave !== pestanaRef.current).clave;
    let n = null;
    try {
      const respuesta = await ordenesService.listar({ ...parametrosDeMisOrdenes({ ambito: otra }), page_size: 1 });
      const cuenta = Number(respuesta?.count);
      n = Number.isFinite(cuenta) ? cuenta : null;
    } catch {
      n = null;
    }
    if (!montado.current || numero !== consulta.current) return;
    setCuentas((c) => ({ ...c, [otra]: n }));
  }, [montado]);

  useEffect(() => {
    setCuentas({ mias: null, asignadas: null });
    contar();
  }, [contar, empresa, versionEmpresa]);

  // Al volver de la ficha (una orden que se cerró ya no cuenta).
  const primeraVez = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeraVez.current) {
        primeraVez.current = false;
        return;
      }
      contar();
    }, [contar]),
  );

  return { cuentas, setCuentas, contar };
}

/** La lista de una pestaña. Va con `key` de la pestaña: al cambiar, empieza
 * de cero y no muestra las filas de la otra mientras carga. */
function ListaDeLaPestana({ ambito, busqueda, cabecera, permisos, empresa, versionEmpresa, onAbrirOrden, onRefrescado, onTotal }) {
  const pedir = useCallback((pagina) => ordenesService.listar(parametrosDeMisOrdenes({ ambito, q: busqueda, pagina })), [ambito, busqueda]);
  const paginada = useListaPaginada(pedir, {
    recargarCon: [empresa, versionEmpresa],
    mensaje: mensajeDeOrdenes,
    textos: {
      cargar: "No se pudieron cargar las órdenes.",
      actualizar: "No se pudieron actualizar las órdenes.",
      mas: "No se pudieron cargar más órdenes.",
    },
  });
  const { lista } = paginada;

  // Sin búsqueda, el total de la lista es el contador de la pestaña.
  useEffect(() => {
    if (lista.estado === "listo" && !lista.recargando && !busqueda) onTotal(ambito, lista.total);
  }, [lista.estado, lista.recargando, lista.total, busqueda, ambito, onTotal]);

  // `paginada` es un objeto nuevo en cada render: se depende de sus partes.
  const { refrescando, cargandoMas, errorMas, cargar, cargarMas, refrescar } = paginada;
  const conRefresco = useMemo(
    () => ({
      lista,
      refrescando,
      cargandoMas,
      errorMas,
      cargar,
      cargarMas,
      refrescar: async () => {
        await Promise.all([refrescar(), onRefrescado()]);
      },
    }),
    [lista, refrescando, cargandoMas, errorMas, cargar, cargarMas, refrescar, onRefrescado],
  );

  const renderItem = useCallback(({ item }) => <FilaOrden orden={item} onAbrir={onAbrirOrden} />, [onAbrirOrden]);

  return (
    <ListaPaginada
      testID={`mis-ordenes-${ambito}`}
      testIDTotal="mis-ordenes-total"
      paginada={conRefresco}
      renderItem={renderItem}
      iconoVacio={ambito === "asignadas" ? "account-hard-hat-outline" : "clipboard-text-outline"}
      total={busqueda ? cuantasOrdenes(lista.total) : null}
      textos={{
        cargando: "Cargando las órdenes…",
        vacio: textoDeListaVacia(ambito, { busqueda, permisos }),
        verMas: "Ver más órdenes",
        cargandoMas: "Cargando más órdenes…",
      }}
      cabecera={cabecera}
    />
  );
}

/**
 * «Mis órdenes» (US-025, CA-7 y CA-8): dos pestañas, «Creadas por mí»
 * (`GET ordenes/?ambito=mias&abiertas=true`) y «Asignadas a mí»
 * (`?ambito=asignadas&abiertas=true`), cada una con su contador. Solo las
 * abiertas, de a 20 con «Ver más», con la búsqueda por número, título, sede
 * o responsable (400 ms de espera) y deslizar para actualizar.
 *
 * «Asignadas a mí» se ve siempre: depende de que la persona sea el técnico de
 * la orden, y a quien no ejecuta órdenes la pestaña vacía le explica por
 * qué. Las que están solo a cargo de un proveedor no aparecen ahí, igual que
 * en la web.
 */
export function MisOrdenes({ pestanaPedida, permisos = [], empresa, versionEmpresa, onAbrirOrden }) {
  const [pestana, setPestana] = useState(() => pestanaValida(pestanaPedida));
  const { texto, setTexto, busqueda, ya } = useBusquedaConEspera(ESPERA_BUSCAR_MS);
  const { cuentas, setCuentas, contar } = useCuentas(pestana, empresa, versionEmpresa);

  useEffect(() => {
    if (pestanaPedida !== undefined) setPestana(pestanaValida(pestanaPedida));
  }, [pestanaPedida]);

  const fijarTotal = useCallback(
    (ambito, total) => setCuentas((c) => (c[ambito] === total ? c : { ...c, [ambito]: total })),
    [setCuentas],
  );

  const cabecera = (
    <>
      <Pestanas actual={pestana} cuentas={cuentas} onCambio={setPestana} />
      <BuscadorDeLista
        testID="buscar-orden"
        texto={texto}
        onCambio={setTexto}
        onBuscar={ya}
        etiqueta="Buscar por número, título, sede o responsable"
        placeholder="Número, título, sede o responsable"
      />
    </>
  );

  return (
    <ListaDeLaPestana
      key={pestana}
      ambito={pestana}
      busqueda={busqueda}
      cabecera={cabecera}
      permisos={permisos}
      empresa={empresa}
      versionEmpresa={versionEmpresa}
      onAbrirOrden={onAbrirOrden}
      onRefrescado={contar}
      onTotal={fijarTotal}
    />
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  pestanas: { flexDirection: "row", gap: 8 },
  pestana: {
    flex: 1,
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colores.bordeControl,
    backgroundColor: colores.superficie,
  },
  pestanaActiva: { backgroundColor: colores.primario, borderColor: colores.primario },
  presionada: { backgroundColor: colores.realce },
  pestanaTexto: { flexShrink: 1, fontSize: 15, fontWeight: "600", color: colores.tinta, textAlign: "center" },
  pestanaTextoActiva: { color: colores.sobrePrimario },
  contador: { minWidth: 26, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 13, backgroundColor: colores.hundido, alignItems: "center" },
  contadorActivo: { backgroundColor: colores.superficie },
  contadorTexto: { fontSize: 14, fontWeight: "700", color: colores.tinta },
  contadorTextoActivo: { color: colores.titulo },
});
