import { useEffect, useRef, useState } from "react";

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
 */
export function EscanerInput({
  onEscanear,
  placeholder = "Escanee o escriba un código",
  className = "",
  enfocarAlMontar = false,
  mantenerFoco = false,
  disabled = false,
}) {
  const [valor, setValor] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (enfocarAlMontar && !disabled) {
      inputRef.current?.focus();
    }
  }, [enfocarAlMontar, disabled]);

  function handleSubmit(event) {
    event.preventDefault();
    const limpio = valor.trim();
    if (!limpio) {
      return;
    }
    onEscanear(limpio);
    setValor("");
    if (mantenerFoco) {
      inputRef.current?.focus();
    }
  }

  return (
    <form className={`escaner-input ${className}`} onSubmit={handleSubmit} role="search">
      <div className="input-group">
        <span className="input-group-text" aria-hidden="true">
          <i className="bi bi-upc-scan" />
        </span>
        <input
          ref={inputRef}
          type="text"
          className="form-control"
          placeholder={placeholder}
          aria-label="Código de barras o número de serie"
          value={valor}
          disabled={disabled}
          autoComplete="off"
          // Una lectora no necesita corrección ortográfica ni mayúsculas
          // automáticas del móvil, que además corromperían el código.
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          onChange={(event) => setValor(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={disabled || !valor.trim()}>
          Buscar
        </button>
      </div>
    </form>
  );
}
