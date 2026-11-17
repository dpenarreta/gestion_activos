import { useEffect, useRef, useState } from "react";

import { almacen } from "../api/almacen";
import { temaService } from "../api/servicios";

/**
 * El título y el subtítulo de la pantalla de acceso (US-028, CA-4), que se
 * personalizan en la web (Configuración › Identidad, commit 45884ab) y llegan
 * en `acceso_titulo` y `acceso_subtitulo` de `GET /theme/current/`, que es
 * público (`CurrentThemeView`, `AllowAny`): se pide sin token.
 *
 * Misma regla que la web (`textoDeAcceso` de `PantallaAcceso.jsx`):
 * - Si el campo no llega (o no es texto) o el pedido falla, el de siempre.
 * - Un subtítulo vaciado a propósito en la web no se muestra. El título no
 *   puede quedar vacío en el servidor; si llegara vacío, va el de siempre,
 *   porque es el encabezado de la pantalla.
 *
 * Para que el texto no salte, se guarda el último recibido (`almacen`, leído
 * al arrancar) y es el que se muestra mientras llega el tema.
 */
export const TEXTOS_ACCESO_POR_DEFECTO = {
  acceso_titulo: "Acceso al sistema",
  acceso_subtitulo: "Ingrese con su usuario corporativo.",
};

const CAMPOS = Object.keys(TEXTOS_ACCESO_POR_DEFECTO);

/** Los dos textos que se muestran, a partir del tema (o de lo guardado). */
export function textosDeAcceso(tema) {
  const titulo = tema?.acceso_titulo;
  const subtitulo = tema?.acceso_subtitulo;
  return {
    titulo: typeof titulo === "string" && titulo.trim() ? titulo.trim() : TEXTOS_ACCESO_POR_DEFECTO.acceso_titulo,
    subtitulo: typeof subtitulo === "string" ? subtitulo.trim() : TEXTOS_ACCESO_POR_DEFECTO.acceso_subtitulo,
  };
}

/** Solo los dos campos del acceso, para guardarlos. */
function soloLosDelAcceso(tema) {
  const guardar = {};
  for (const campo of CAMPOS) {
    if (typeof tema?.[campo] === "string") guardar[campo] = tema[campo];
  }
  return guardar;
}

/**
 * Los textos del acceso: primero los guardados (o los de siempre) y, cuando
 * responde el servidor, los suyos, que quedan guardados para la próxima vez.
 */
export function useTextosDeAcceso() {
  const [tema, setTema] = useState(() => almacen.textosDeAcceso());
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    (async () => {
      try {
        const respuesta = await temaService.actual();
        const nuevos = soloLosDelAcceso(respuesta);
        if (!Object.keys(nuevos).length) return;
        if (montado.current) setTema(nuevos);
        await almacen.guardarTextosDeAcceso(nuevos);
      } catch {
        // Sin red o sin tema: se quedan los guardados o los de siempre.
      }
    })();
    return () => {
      montado.current = false;
    };
  }, []);

  return textosDeAcceso(tema);
}
