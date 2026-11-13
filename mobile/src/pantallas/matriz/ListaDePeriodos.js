import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from "react-native";

import { matrizService } from "../../api/servicios";
import { Alerta, Boton, Cargando, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { cuantas, mensajeDeMatriz } from "../../matriz/formato";
import { useEmpresaDeLaMatriz } from "../../matriz/useEmpresaDeLaMatriz";
import { useSesion } from "../../sesion/SesionContext";
import { colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { Separador } from "../soporte/piezas";
import { FilaPeriodo, SinRolMatriz } from "./piezas";

const LISTA_VACIA = { estado: "cargando", items: [], total: 0, hayMas: false, error: null, aviso: null };

/**
 * Una lista de obligaciones (períodos) de `GET matriz/periodos/` (US-019): la
 * de un estado de la Bandeja (CA-3, `status` y `sort` como la web) y la de un
 * día del calendario (CA-7, `due_from` y `due_to`). De a 20, con más al
 * llegar al final o con «Ver más»; se refresca al tirar hacia abajo y al
 * volver a ella (tras una acción en el detalle, CA-5). Muestra los estados de
 * carga, error con «Reintentar» y vacío.
 *
 * Ronda 1 (13/11/2026): el título va solo en la cabecera de la pila (pedido
 * del usuario); dentro, `detalle` (la fecha del día, si aporta), la nota y el
 * total. Se vuelve a pedir al cambiar de empresa.
 */
export function ListaDePeriodos({ params, detalle, nota, textoVacio, testID = "lista-de-periodos" }) {
  const router = useRouter();
  const { versionEmpresa } = useSesion();
  const matriz = useEmpresaDeLaMatriz();
  const [lista, setLista] = useState(LISTA_VACIA);
  const [refrescando, setRefrescando] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorMas, setErrorMas] = useState(null);
  const montado = useRef(true);
  const consulta = useRef(0);
  const paginas = useRef(0);
  const pidiendoMas = useRef(false);
  const listaRef = useRef(lista);
  listaRef.current = lista;
  const clave = JSON.stringify(params ?? {});

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(
    async ({ silenciosa = false } = {}) => {
      const numero = ++consulta.current;
      // Al refrescar se vuelve a pedir lo que ya se ve (hasta 100).
      const tamano = silenciosa ? Math.min(100, Math.max(1, paginas.current) * 20) : undefined;
      if (!silenciosa) {
        paginas.current = 0;
        setLista(LISTA_VACIA);
      }
      setErrorMas(null);
      try {
        const respuesta = await matrizService.periodos({ ...JSON.parse(clave), page: 1, page_size: tamano });
        if (!montado.current || numero !== consulta.current) return;
        const items = Array.isArray(respuesta?.results) ? respuesta.results : [];
        // B-2 (ronda 1): tras un refresco que volvió a pedir lo que se veía
        // (hasta 100), la siguiente página de 20 es la que sigue a esas filas.
        paginas.current = silenciosa ? Math.max(1, Math.ceil(items.length / 20)) : 1;
        setLista({
          estado: "listo",
          items,
          total: Number(respuesta?.count ?? items.length),
          hayMas: Boolean(respuesta?.next),
          error: null,
          aviso: null,
        });
      } catch (e) {
        if (!montado.current || numero !== consulta.current) return;
        const sinRol = e?.response?.status === 404;
        if (silenciosa && listaRef.current.estado === "listo" && !sinRol) {
          setLista((l) => ({
            ...l,
            aviso: `${mensajeDeMatriz(e, "No se pudo actualizar la lista.")} Se muestra la anterior.`,
          }));
        } else {
          setLista({
            ...LISTA_VACIA,
            estado: sinRol ? "sin_rol" : "error",
            error: sinRol ? null : mensajeDeMatriz(e, "No se pudo cargar la lista de obligaciones."),
          });
        }
      }
    },
    [clave],
  );

  useEffect(() => {
    cargar();
  }, [cargar, versionEmpresa]);

  const primeraVez = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeraVez.current) {
        primeraVez.current = false;
        return;
      }
      if (listaRef.current.estado === "listo") cargar({ silenciosa: true });
    }, [cargar]),
  );

  async function cargarMas() {
    const actual = listaRef.current;
    if (pidiendoMas.current || actual.estado !== "listo" || !actual.hayMas) return;
    pidiendoMas.current = true;
    setCargandoMas(true);
    setErrorMas(null);
    const numero = consulta.current;
    const pagina = paginas.current + 1;
    try {
      const respuesta = await matrizService.periodos({ ...JSON.parse(clave), page: pagina });
      if (!montado.current || numero !== consulta.current) return;
      paginas.current = pagina;
      const nuevos = Array.isArray(respuesta?.results) ? respuesta.results : [];
      setLista((l) => {
        const vistos = new Set(l.items.map((p) => p.id));
        return {
          ...l,
          items: [...l.items, ...nuevos.filter((p) => !vistos.has(p.id))],
          total: Number(respuesta?.count ?? l.total),
          hayMas: Boolean(respuesta?.next),
        };
      });
    } catch (e) {
      if (!montado.current || numero !== consulta.current) return;
      // La página ya no existe (la lista se acortó): desde el principio.
      if (e?.response?.status === 404) {
        pidiendoMas.current = false;
        cargar();
        return;
      }
      setErrorMas(mensajeDeMatriz(e, "No se pudieron cargar más obligaciones."));
    } finally {
      pidiendoMas.current = false;
      if (montado.current) setCargandoMas(false);
    }
  }

  async function refrescar() {
    setRefrescando(true);
    await cargar({ silenciosa: listaRef.current.estado === "listo" });
    if (montado.current) setRefrescando(false);
  }

  const abrir = useCallback(
    (p) => router.push({ pathname: "/matriz/periodo/[id]", params: { id: String(p.id) } }),
    [router],
  );
  const zona = matriz.zona;
  const renderItem = useCallback(
    ({ item }) => <FilaPeriodo periodo={item} zona={zona} onAbrir={abrir} />,
    [zona, abrir],
  );

  let vacio;
  if (lista.estado === "cargando") vacio = <Cargando texto="Cargando las obligaciones…" />;
  else if (lista.estado === "sin_rol") vacio = <SinRolMatriz />;
  else if (lista.estado === "error") vacio = <ErrorConReintento texto={lista.error} onReintentar={() => cargar()} />;
  else vacio = <Vacio icono="book-check-outline" texto={textoVacio} />;

  return (
    <FlatList
      testID={testID}
      style={estilos.lista}
      contentContainerStyle={estilos.contenido}
      data={lista.estado === "listo" ? lista.items : []}
      keyExtractor={(p) => String(p.id)}
      ListHeaderComponent={
        <View style={estilos.cabecera}>
          {detalle ? <Text style={estilos.detalle}>{detalle}</Text> : null}
          {nota ? <Text style={estilos.tenue}>{nota}</Text> : null}
          {lista.estado === "listo" ? (
            <Text style={estilos.tenue} accessibilityLiveRegion="polite" testID="total-de-periodos">
              {cuantas(lista.total)}
            </Text>
          ) : null}
          {lista.aviso ? <Alerta tipo="mal" texto={lista.aviso} /> : null}
        </View>
      }
      ListEmptyComponent={vacio}
      ListFooterComponent={
        <View style={estilos.pie}>
          {cargandoMas ? (
            <View accessible accessibilityRole="progressbar" accessibilityLabel="Cargando más obligaciones…">
              <ActivityIndicator color={colores.primario} />
            </View>
          ) : null}
          {errorMas ? <ErrorConReintento texto={errorMas} onReintentar={cargarMas} /> : null}
          {lista.estado === "listo" && lista.hayMas && !cargandoMas && !errorMas ? (
            <Boton
              testID="ver-mas"
              titulo="Ver más obligaciones"
              icono="chevron-down"
              variante="secundario"
              onPress={cargarMas}
            />
          ) : null}
        </View>
      }
      onEndReached={() => {
        cargarMas();
      }}
      onEndReachedThreshold={0.4}
      renderItem={renderItem}
      ItemSeparatorComponent={Separador}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
    />
  );
}

const estilos = crearEstilos({
  lista: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, paddingBottom: 32 },
  cabecera: { gap: 4, marginBottom: 12 },
  detalle: { fontSize: 16, fontWeight: "600", color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  pie: { marginTop: 12, gap: 8 },
});
