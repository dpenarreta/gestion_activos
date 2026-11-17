import { useNavigation, usePreventRemove } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";

import { erroresPorCampo, mensajeDeError } from "../../api/errores";
import { mensajeDeActivos, TEXTO_PUEDE_HABERSE_GUARDADO } from "../../activos/formato";
import { confirmarDescarte } from "../../componentes/confirmarDescarte";
import { sinRespuestaClara } from "../../soporte/formato";

/**
 * Lo que comparten los formularios de la Tanda B de la US-022 (registrar y
 * cerrar un mantenimiento, adjuntar, crear un componente, pedir un equipo y
 * mover una solicitud), con las reglas de los de la ficha
 * (`AccionesDelActivo.js`):
 *
 * - un doble toque hace una sola petición (`useCandado`, que se cierra antes
 *   del primer `await`);
 * - los errores 400 van junto a su campo y arriba se dice qué revisar;
 * - sin respuesta clara del servidor se dice que pudo haberse guardado y el
 *   siguiente envío pide confirmación (`useReenvioConfirmado`, QA-FUNC B4);
 * - salir con cambios pregunta (`confirmarDescarte`).
 *
 * Los usan también «Asignar» y «Cambiar estado» de la ficha
 * (`AccionesDelActivo.js`, QA-TECH H-18).
 */

/** Un candado que se cierra antes del primer `await`. */
export function useCandado() {
  const cerrado = useRef(false);
  return useMemo(
    () => ({
      tomar() {
        if (cerrado.current) return false;
        cerrado.current = true;
        return true;
      },
      soltar() {
        cerrado.current = false;
      },
    }),
    [],
  );
}

/** «Revise los campos: Responsable y Descripción.» con los nombres de
 * `nombres` (`{campo: nombre}`), en su orden. */
export function textoRevise(campos, nombres) {
  const lista = Object.keys(nombres)
    .filter((c) => campos[c])
    .map((c) => nombres[c]);
  if (lista.length === 0) return "Revise los campos marcados.";
  const unidos = lista.length === 1 ? lista[0] : `${lista.slice(0, -1).join(", ")} y ${lista.at(-1)}`;
  return `Revise ${lista.length === 1 ? "el campo" : "los campos"}: ${unidos}.`;
}

/**
 * El error de un guardado: `{texto, campos, clave}`. `nombres` son los
 * campos que la pantalla muestra (`{campo: nombre}`):
 *
 * - si todos los del 400 se ven y el servidor no dice nada propio, arriba
 *   va «Revise los campos: …» y cada mensaje junto a su campo;
 * - el mensaje de un campo que la pantalla NO muestra (el `estado` de un
 *   activo que pasó a «Perdido» mientras se asignaba, QA-FUNC B2) se dice
 *   arriba tal cual, sin el nombre técnico del campo;
 * - sin campos, el mensaje del servidor (o el de CA-2).
 *
 * `opciones` (US-025, 17/11/2026, aditivas): `mensaje(error, porDefecto,
 * {envio})` y `textoDudoso`, para que las órdenes de trabajo nombren su
 * módulo. Sin ellas, los de Gestión de Activos.
 */
export function errorDeGuardado(e, porDefecto, nombres, opciones = {}) {
  const { mensaje = mensajeDeActivos, textoDudoso = TEXTO_PUEDE_HABERSE_GUARDADO } = opciones;
  if (sinRespuestaClara(e)) return { texto: textoDudoso, campos: {}, clave: Date.now(), dudoso: true };
  const campos = erroresPorCampo(e);
  const propio = e?.response?.data?.error?.message;
  const generico = !propio || propio === "Error en la solicitud.";
  const visibles = Object.keys(campos).filter((c) => nombres[c]);
  const ocultos = Object.keys(campos).filter((c) => !nombres[c]);
  let texto;
  if (ocultos.length) {
    texto = [...ocultos.map((c) => campos[c]), visibles.length ? textoRevise(campos, nombres) : null].filter(Boolean).join(" ");
  } else if (visibles.length) {
    texto = generico ? textoRevise(campos, nombres) : mensajeDeError(e, porDefecto);
  } else {
    texto = mensaje(e, porDefecto, { envio: true });
  }
  return { texto, campos, clave: Date.now(), dudoso: false };
}

export const TITULO_REENVIO = "Puede que ya se haya guardado";
export const TEXTO_REENVIO =
  "La última vez no hubo respuesta del servidor. Si se guardó, enviarlo otra vez lo duplicaría. ¿Enviar de nuevo?";

/**
 * QA-FUNC B4: después de «puede haberse guardado» no se reenvía a ciegas.
 * `marcar(fallo)` recuerda si el último envío quedó en duda;
 * `confirmar()` resuelve `true` si no hay duda o si la persona elige
 * «Enviar de nuevo». Un envío que sale bien o falla con respuesta clara
 * limpia la duda.
 */
export function useReenvioConfirmado() {
  const dudoso = useRef(false);
  return useMemo(
    () => ({
      marcar(fallo) {
        dudoso.current = Boolean(fallo?.dudoso);
      },
      limpiar() {
        dudoso.current = false;
      },
      confirmar() {
        if (!dudoso.current) return Promise.resolve(true);
        return new Promise((resolver) => {
          Alert.alert(
            TITULO_REENVIO,
            TEXTO_REENVIO,
            [
              { text: "No, revisar primero", style: "cancel", onPress: () => resolver(false) },
              { text: "Enviar de nuevo", onPress: () => resolver(true) },
            ],
            { cancelable: true, onDismiss: () => resolver(false) },
          );
        });
      },
    }),
    [],
  );
}

export const TITULO_GUARDANDO = "Guardando…";
export const TEXTO_GUARDANDO = "Espere a que termine de guardar antes de salir.";

/**
 * Salir de una pantalla de la pila con cambios sin guardar pregunta antes
 * (`confirmarDescarte`, CA-14 y CA-19), con el gesto, la flecha o Atrás.
 * `activo`: si hay algo que perder y no se está guardando. Devuelve
 * `salir(accion)`, para irse sin preguntar tras guardar.
 *
 * `ocupado` (US-023, QA-FUNC B-2 y QA-TECH P3 #5): con el envío en curso no
 * se sale; se avisa «Guardando…» y la pantalla se queda. Si no, el
 * resultado llegaría a una pantalla que ya no está y la persona no sabría si
 * se guardó.
 */
export function useSalirConCambios(activo, { ocupado = false } = {}) {
  const navegacion = useNavigation();
  const [libre, setLibre] = useState(false);
  const pendiente = useRef(null);
  const ocupadoRef = useRef(ocupado);
  ocupadoRef.current = ocupado;

  usePreventRemove((Boolean(activo) || Boolean(ocupado)) && !libre, ({ data }) => {
    if (ocupadoRef.current) {
      Alert.alert(TITULO_GUARDANDO, TEXTO_GUARDANDO);
      return;
    }
    confirmarDescarte().then((descartar) => {
      if (!descartar) return;
      pendiente.current = () => navegacion.dispatch(data.action);
      setLibre(true);
    });
  });

  // La navegación pendiente sale cuando `usePreventRemove` ya dejó de
  // impedirla (revisión UX de la US-010, M-2).
  useEffect(() => {
    if (!libre || !pendiente.current) return;
    const navegar = pendiente.current;
    pendiente.current = null;
    navegar();
  }, [libre]);

  return {
    /** Libera la pantalla y luego navega con `accion`. */
    salir(accion) {
      pendiente.current = accion;
      setLibre(true);
    },
  };
}
