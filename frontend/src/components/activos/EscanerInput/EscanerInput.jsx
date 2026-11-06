import { useEffect, useRef } from "react";

import { BuscadorConSugerencias } from "../../common/BuscadorConSugerencias/BuscadorConSugerencias";
import "./EscanerInput.css";

/**
 * Campo de captura para lectoras de código de barras (RF-03).
 *
 * Las pistolas USB/Bluetooth se comportan como un teclado HID: "teclean" el
 * código carácter por carácter y cierran con Enter. Eso significa que un
 * `<input>` común ya funciona, y este componente existe por lo que un input
 * pelado no resuelve: limpiar el campo tras cada lectura (sin eso, el
 * segundo escaneo se concatena al primero y produce un código inexistente) y,
 * donde corresponde, mantener el foco.
 *
 * El enfoque se hace por `ref` en un
 * efecto y no con el atributo `autoFocus` del DOM: así el foco se puede
 * condicionar y devolver tras cada lectura, que es lo que hace falta aquí.
 *
 * `mantenerFoco` está apagado por defecto a propósito. En la pantalla
 * dedicada al escáner el técnico dispara la pistola sin tocar la pantalla y
 * conviene recuperar el foco tras cualquier clic; pero en un listado con
 * filtros, hacerlo le arrebataría el foco al desplegable que el usuario acaba
 * de abrir. La misma "ayuda" es correcta en un caso e inutilizante en el otro.
 *
 * No se intenta distinguir "tecleado a mano" de "escaneado" midiendo la
 * velocidad entre pulsaciones: es una heurística frágil (un teclado mecánico
 * rápido la engaña, una pistola Bluetooth lenta también) y no aportaría nada,
 * porque en ambos casos la acción resultante es la misma.
 *
 * Búsqueda en vivo (06/11/2026): con `sugerir`, al escribir a mano aparecen
 * debajo los equipos que coinciden —para quien no tiene la etiqueta legible y
 * busca por serie o por nombre—. La lectura sigue siendo el Enter: la pistola
 * cierra con él antes de que la espera de las sugerencias se cumpla, así que
 * no nota nada. El campo ya no se deshabilita mientras se consulta: perdía el
 * foco y con él la lectura siguiente; ahora se vacía en cuanto sale la
 * consulta y queda listo para el próximo disparo.
 */
export function EscanerInput({
  onEscanear,
  placeholder = "Escanee o escriba un código",
  className = "",
  enfocarAlMontar = false,
  mantenerFoco = false,
  disabled = false,
  // Nombre de la región de búsqueda. En el inventario conviven esta y la
  // barra de filtros, y dos regiones «search» sin nombre no se distinguen
  // en la lista de regiones del lector de pantalla (auditoría UX/UI, fase 2,
  // 28/10/2026).
  etiquetaRegion = "Buscar por código con el escáner",
  // Sugerencias en vivo (opcionales): `sugerir(texto)` devuelve una promesa
  // con los equipos; `alElegirSugerencia(equipo)` decide qué hacer con uno.
  sugerir,
  alElegirSugerencia,
  contenidoSugerencia,
  textoVerTodos,
  alVerTodos,
  textoSinSugerencias,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (enfocarAlMontar && !disabled) {
      inputRef.current?.focus();
    }
  }, [enfocarAlMontar, disabled]);

  function confirmar(limpio) {
    // Sin esperar la respuesta: el campo se vacía ya y la lectura siguiente
    // no se pega detrás de esta ni se pierde mientras viaja.
    onEscanear(limpio);
    if (mantenerFoco) {
      inputRef.current?.focus();
    }
  }

  return (
    <BuscadorConSugerencias
      className={`escaner-input ${className}`}
      claseGrupo="input-group"
      claseCampo="form-control"
      campoRef={inputRef}
      etiqueta="Código de barras o número de serie"
      etiquetaRegion={etiquetaRegion}
      placeholder={placeholder}
      icono="upc-scan"
      buscar={sugerir ?? (() => Promise.resolve([]))}
      // Sin `sugerir`, nunca se llega a pedir nada.
      minimo={sugerir ? 2 : Infinity}
      claveDe={(equipo) => equipo.id}
      contenidoDe={contenidoSugerencia ?? ((equipo) => equipo.nombre)}
      alElegir={(equipo) => {
        alElegirSugerencia?.(equipo);
        if (mantenerFoco) inputRef.current?.focus();
      }}
      alConfirmar={confirmar}
      textoVerTodos={textoVerTodos}
      alVerTodos={alVerTodos}
      textoSinSugerencias={textoSinSugerencias}
      sufijo={({ texto }) => (
        <button
          type="submit"
          className="btn btn-primary"
          disabled={disabled || !texto.trim()}
        >
          Buscar
        </button>
      )}
    />
  );
}
