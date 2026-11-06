import { useCallback, useEffect, useRef, useState } from "react";

/** Cuánto se espera a que se deje de teclear antes de preguntar al servidor. */
export const ESPERA_BUSQUEDA_MS = 300;

/**
 * Un buscador que filtra mientras se escribe (búsqueda en vivo, 06/11/2026).
 *
 * Antes casi todos los listados esperaban a «Buscar» o a Enter; el pedido fue
 * que todos los buscadores filtren al ir tecleando. Este hook es la parte
 * común de los que consultan al servidor:
 *
 * - **Debounce.** Lo escrito se aplica `espera` ms después de la última tecla:
 *   una consulta por palabra, no una por letra. Vaciar el campo (la X del
 *   `type="search"`, Escape o borrar todo) se aplica al instante: no hay nada
 *   que esperar para volver a ver la lista entera.
 * - **Enter busca ya.** `buscarYa()` (o `alTeclear` con Enter) cancela la
 *   espera y aplica de inmediato. Es lo que necesita la pistola lectora, que
 *   teclea el código de golpe y cierra con Enter: su flujo queda igual que
 *   antes, sin esperar los 300 ms.
 * - **Sin repetir.** Si lo que se va a aplicar es lo mismo que ya está
 *   aplicado (sin contar espacios a los lados), no se vuelve a llamar a
 *   `alBuscar`: el Enter que llega tras el debounce, o el `submit` del
 *   formulario que acompaña al Enter, no disparan una segunda consulta igual.
 *
 * Lo que **no** hace, a propósito: descartar respuestas viejas y conservar la
 * lista mientras llega la nueva. Eso es de quien consulta —`useListadoPaginado`
 * ya lo hace con su contador de turno, y `useUltimaPeticion` para el resto—;
 * duplicarlo aquí daría dos guardas que se pueden contradecir.
 *
 * Para filtrar una lista ya cargada en el navegador no hace falta: el filtro
 * va en cada tecla, con `useDeferredValue` si la lista es grande.
 *
 *     const busqueda = useBusquedaEnVivo({
 *       inicial: listado.filtros.q,
 *       alBuscar: (q) => listado.actualizarFiltros({ q }),
 *     });
 *     <input type="search" {...busqueda.propsCampo} />
 *
 * @param {object} opciones
 * @param {string} [opciones.inicial] texto con el que arranca (p. ej. de la URL)
 * @param {(termino: string) => void} opciones.alBuscar recibe el texto sin
 *   espacios a los lados
 * @param {number} [opciones.espera] ms de debounce
 */
export function useBusquedaEnVivo({
  inicial = "",
  alBuscar,
  espera = ESPERA_BUSQUEDA_MS,
} = {}) {
  const [texto, setTexto] = useState(inicial ?? "");
  // Lo último que se entregó a `alBuscar`: el término vigente.
  const [aplicado, setAplicado] = useState((inicial ?? "").trim());
  const aplicadoRef = useRef((inicial ?? "").trim());
  // El texto al instante, para que `buscarYa` no lea un estado de un render
  // anterior cuando el Enter llega en el mismo tick que la última letra (la
  // pistola teclea así de rápido).
  const textoRef = useRef(inicial ?? "");
  const temporizador = useRef(null);
  // La función más reciente sin rehacer los callbacks en cada render: las
  // pantallas la escriben en línea.
  const alBuscarRef = useRef(alBuscar);
  useEffect(() => {
    alBuscarRef.current = alBuscar;
  });

  useEffect(() => () => clearTimeout(temporizador.current), []);

  const aplicar = useCallback((valor, { forzar = false } = {}) => {
    clearTimeout(temporizador.current);
    const termino = String(valor ?? "").trim();
    if (!forzar && termino === aplicadoRef.current) return;
    aplicadoRef.current = termino;
    setAplicado(termino);
    alBuscarRef.current?.(termino);
  }, []);

  const cambiar = useCallback(
    (eventoOValor) => {
      const valor =
        typeof eventoOValor === "string"
          ? eventoOValor
          : (eventoOValor?.target?.value ?? "");
      textoRef.current = valor;
      setTexto(valor);
      clearTimeout(temporizador.current);
      if (!valor.trim()) {
        aplicar(valor);
        return;
      }
      temporizador.current = setTimeout(() => aplicar(valor), espera);
    },
    [aplicar, espera],
  );

  /** Aplica ya lo escrito, sin esperar. `{ forzar: true }` repite la consulta. */
  const buscarYa = useCallback(
    (opciones) => aplicar(textoRef.current, opciones),
    [aplicar],
  );

  /** Vacía el campo y la búsqueda. */
  const limpiar = useCallback(() => {
    textoRef.current = "";
    setTexto("");
    aplicar("");
  }, [aplicar]);

  /**
   * Pone un texto sin buscar: para cuando la pantalla ya aplicó el filtro por
   * su cuenta (un «Limpiar filtros» que vacía todo de una vez, la URL que
   * cambió con Atrás) y solo hay que dejar el campo de acuerdo.
   */
  const fijar = useCallback((valor = "") => {
    clearTimeout(temporizador.current);
    textoRef.current = valor;
    setTexto(valor);
    aplicadoRef.current = valor.trim();
    setAplicado(valor.trim());
  }, []);

  const alTeclear = useCallback(
    (evento) => {
      // Durante la composición (tildes con teclas muertas, IME) Enter
      // confirma el carácter, no la búsqueda.
      if (evento.key === "Enter" && !evento.nativeEvent?.isComposing) {
        buscarYa();
      }
    },
    [buscarYa],
  );

  return {
    /** Lo que hay escrito en el campo. */
    texto,
    /** Lo que está aplicado (sin espacios a los lados). */
    termino: aplicado,
    /** Hay una búsqueda esperando a que se deje de escribir. */
    pendiente: texto.trim() !== aplicado,
    cambiar,
    buscarYa,
    limpiar,
    fijar,
    alTeclear,
    /** Para esparcir en el `<input type="search">`. */
    propsCampo: { value: texto, onChange: cambiar, onKeyDown: alTeclear },
  };
}

/**
 * Lo que devuelve el servidor para un texto que se va escribiendo, para los
 * buscadores que no son un listado paginado (el directorio del chat, un
 * selector de personas). Pregunta `espera` ms después de la última tecla —con
 * el texto vacío, al instante— y **solo cuenta la respuesta del texto
 * vigente**: una lenta de «ma» no pisa a la de «maría» que llegó antes.
 * Mientras llega la nueva, `datos` conserva la anterior (para atenuarla con
 * `aria-busy={cargando}` en vez de vaciar la lista).
 *
 *     const { datos, cargando, error } = useResultadosEnVivo(texto, (q) =>
 *       chatService.directorio(q),
 *     );
 *
 * @param {string} texto lo escrito (se recorta)
 * @param {(termino: string) => Promise<unknown>} consultar
 * @param {object} [opciones]
 * @param {number} [opciones.espera]
 * @param {unknown} [opciones.vez] cambiarlo repite la consulta (reintentar)
 */
export function useResultadosEnVivo(
  texto,
  consultar,
  { espera = ESPERA_BUSQUEDA_MS, vez } = {},
) {
  const [estado, setEstado] = useState({
    datos: null,
    cargando: true,
    error: null,
  });
  const consultarRef = useRef(consultar);
  useEffect(() => {
    consultarRef.current = consultar;
  });
  const termino = String(texto ?? "").trim();

  useEffect(() => {
    let vigente = true;
    setEstado((actual) => ({ ...actual, cargando: true }));
    const pausa = setTimeout(
      () => {
        Promise.resolve()
          .then(() => consultarRef.current(termino))
          .then((datos) => {
            if (vigente) setEstado({ datos, cargando: false, error: null });
          })
          .catch((error) => {
            if (vigente)
              setEstado((actual) => ({ ...actual, cargando: false, error }));
          });
      },
      termino ? espera : 0,
    );
    return () => {
      vigente = false;
      clearTimeout(pausa);
    };
  }, [termino, espera, vez]);

  return { ...estado, termino };
}
