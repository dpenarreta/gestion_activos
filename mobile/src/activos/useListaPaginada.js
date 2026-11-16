import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { mensajeDeActivos } from "./formato";

const LISTA_VACIA = { estado: "cargando", items: [], total: 0, hayMas: false, error: null, aviso: null };

/**
 * Una lista paginada de Gestión de Activos (la bitácora, Mis solicitudes y
 * Recibidas; US-022, Tanda B), con el mismo comportamiento que el inventario
 * (CA-5, CA-6, CA-22):
 *
 * - `pedir(pagina)` devuelve la página de DRF (`{count, next, results}`); al
 *   cambiar (otro filtro o búsqueda) se pide desde el principio;
 * - `recargarCon`: valores que también la reinician (la empresa activa);
 * - se refresca en silencio al volver a la pantalla y al tirar hacia abajo,
 *   conservando lo anterior si falla;
 * - «cargar más» no repite filas y, si la página ya no existe, empieza de
 *   nuevo;
 * - una respuesta vieja no pisa a una nueva.
 */
export function useListaPaginada(pedir, { recargarCon = [], textos }) {
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
  const textosRef = useRef(textos);
  textosRef.current = textos;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(
    async ({ silenciosa = false, conservar = false } = {}) => {
      const numero = ++consulta.current;
      if (conservar) {
        // UX H-19: otra búsqueda u otro filtro. Lo anterior se queda a la
        // vista, con «Actualizando…», hasta que llegue lo nuevo.
        setLista((l) => ({ ...l, recargando: true, aviso: null }));
      } else if (!silenciosa) {
        paginas.current = 0;
        setLista(LISTA_VACIA);
      }
      setErrorMas(null);
      try {
        const respuesta = await pedir(1);
        if (!montado.current || numero !== consulta.current) return;
        const items = Array.isArray(respuesta?.results) ? respuesta.results : [];
        paginas.current = 1;
        setLista({
          estado: "listo",
          items,
          total: Number(respuesta?.count ?? items.length),
          hayMas: Boolean(respuesta?.next),
          error: null,
          aviso: respuesta?.advertencia_lector || null,
          recargando: false,
        });
      } catch (e) {
        if (!montado.current || numero !== consulta.current) return;
        if (silenciosa && listaRef.current.estado === "listo") {
          const texto = `${mensajeDeActivos(e, textosRef.current.actualizar)} Se muestra la anterior.`;
          setLista((l) => ({ ...l, aviso: texto }));
        } else {
          setLista({ ...LISTA_VACIA, estado: "error", error: mensajeDeActivos(e, textosRef.current.cargar) });
        }
      }
    },
    [pedir, montado],
  );

  // Otra empresa (CA-22): desde cero, nada de la anterior queda a la vista.
  // Otro filtro o búsqueda: se conserva lo anterior mientras carga (H-19).
  const claveDeEmpresa = recargarCon.map((x) => String(x ?? "")).join("|");
  const empresaPrevia = useRef(claveDeEmpresa);
  useEffect(() => {
    const otraEmpresa = empresaPrevia.current !== claveDeEmpresa;
    empresaPrevia.current = claveDeEmpresa;
    cargar({ conservar: !otraEmpresa && listaRef.current.estado === "listo" });
  }, [cargar, claveDeEmpresa]);

  // Solo al volver a la pantalla: el efecto no depende de `cargar` (un
  // filtro nuevo cambia `cargar` y, en expo-router, volvería a correr el
  // efecto con la pantalla enfocada: dos pedidos por cada cambio).
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;
  const primeraVez = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeraVez.current) {
        primeraVez.current = false;
        return;
      }
      if (listaRef.current.estado === "listo") cargarRef.current({ silenciosa: true });
    }, []),
  );

  const cargarMas = useCallback(async () => {
    const actual = listaRef.current;
    if (pidiendoMas.current || actual.estado !== "listo" || actual.recargando || !actual.hayMas) return;
    pidiendoMas.current = true;
    setCargandoMas(true);
    setErrorMas(null);
    const numero = consulta.current;
    const pagina = paginas.current + 1;
    try {
      const respuesta = await pedir(pagina);
      if (!montado.current || numero !== consulta.current) return;
      paginas.current = pagina;
      const nuevos = Array.isArray(respuesta?.results) ? respuesta.results : [];
      setLista((l) => {
        const vistos = new Set(l.items.map((x) => x.id));
        return {
          ...l,
          items: [...l.items, ...nuevos.filter((x) => !vistos.has(x.id))],
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
      setErrorMas(mensajeDeActivos(e, textosRef.current.mas));
    } finally {
      pidiendoMas.current = false;
      if (montado.current) setCargandoMas(false);
    }
  }, [pedir, cargar, montado]);

  const refrescar = useCallback(async () => {
    setRefrescando(true);
    await cargar({ silenciosa: listaRef.current.estado === "listo" });
    if (montado.current) setRefrescando(false);
  }, [cargar, montado]);

  return { lista, refrescando, cargandoMas, errorMas, cargar, cargarMas, refrescar };
}

/** El texto de la búsqueda, con la espera de 400 ms (CA-6): `busqueda` es
 * lo que se pide; `ya()` la aplica sin esperar (la tecla «Buscar»). */
export function useBusquedaConEspera(espera) {
  const [texto, setTexto] = useState("");
  const [busqueda, setBusqueda] = useState("");
  useEffect(() => {
    const limpio = texto.trim();
    if (limpio === busqueda) return undefined;
    const pausa = setTimeout(() => setBusqueda(limpio), espera);
    return () => clearTimeout(pausa);
  }, [texto, busqueda, espera]);
  const limpiar = useCallback(() => {
    setTexto("");
    setBusqueda("");
  }, []);
  const ya = useCallback(() => setBusqueda(texto.trim()), [texto]);
  return { texto, setTexto, busqueda, limpiar, ya };
}
