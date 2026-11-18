import { useRouter } from "expo-router";
import { useCallback, useRef } from "react";

/**
 * Abrir la tarjeta de contacto de una persona (`/chat/contacto/[id]`) desde
 * cualquier sitio del chat (US-031, CA-4): «Nuevo mensaje», el título y el
 * ícono de una conversación directa, el avatar de la lista de chats y los
 * participantes de un grupo. Una sola ruta y una sola forma de pasar la
 * empresa: la de la conversación si se conoce (va como `X-Empresa`); si no,
 * ninguna y la tarjeta usa la empresa activa.
 */

/** Lo que se oye antes de abrirla, en todas las entradas. */
export const PISTA_CONTACTO = "Abre su correo, teléfono, extensión y área.";

/** Dos toques seguidos dentro de este margen abren una sola tarjeta. */
export const CANDADO_CONTACTO_MS = 1000;

/** La ruta de la tarjeta, para `router.push`. Sin `id` válido, `null`. */
export function rutaDelContacto(id, empresa = null) {
  if (id === null || id === undefined || id === "") return null;
  const params = { id: String(id) };
  if (empresa) params.empresa = String(empresa);
  return { pathname: "/chat/contacto/[id]", params };
}

/**
 * Devuelve `abrir(id, empresa?)`, que lleva a la tarjeta una sola vez aunque
 * se toque dos veces seguidas (sin temporizadores: se compara la hora del
 * último toque, así no queda nada pendiente al desmontar).
 */
export function useAbrirContacto() {
  const router = useRouter();
  const ultimo = useRef(0);
  return useCallback(
    (id, empresa = null) => {
      const ruta = rutaDelContacto(id, empresa);
      if (!ruta) return;
      const ahora = Date.now();
      if (ahora - ultimo.current < CANDADO_CONTACTO_MS) return;
      ultimo.current = ahora;
      router.push(ruta);
    },
    [router],
  );
}
