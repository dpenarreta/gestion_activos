import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import { Text, View } from "react-native";

import { useEmpresaDeLaMatriz } from "../../matriz/useEmpresaDeLaMatriz";
import { moduloPorId, vistaActiva } from "../../navegacion/modulos";
import { useContextoDeNavegacion } from "../../navegacion/useContextoDeNavegacion";
import { useSesion } from "../../sesion/SesionContext";
import { colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { crearEstilos } from "../../tema/tipografia";
import { BandejaMatriz } from "./BandejaMatriz";
import { CalendarioMatriz } from "./CalendarioMatriz";

const MODULO_MATRIZ = moduloPorId("matriz");

/** El título pequeño de cada vista (H-10 de la US-016). */
const TITULOS = { bandeja: "Bandeja", calendario: "Calendario" };

/**
 * La Matriz de obligaciones en la app (US-019, 13/11/2026): un módulo con su
 * pestaña arriba, después de la Mesa de ayuda, y dos vistas en la barra de
 * abajo, **Bandeja** (por defecto) y **Calendario**. La vista sale de
 * `?vista=` (la barra y los enlaces). La empresa de la Matriz (zona horaria,
 * roles) se pide una vez y la comparten las dos.
 */
export function Matriz() {
  const router = useRouter();
  const parametros = useLocalSearchParams();
  const { usuario, empresaActiva } = useSesion();
  const contexto = useContextoDeNavegacion();
  const actual = vistaActiva(MODULO_MATRIZ, { name: "matriz", params: parametros }, contexto);
  const matriz = useEmpresaDeLaMatriz();

  const abrirEstado = useCallback(
    (e) => router.push({ pathname: "/matriz/estado/[estado]", params: { estado: e.clave } }),
    [router],
  );
  const abrirPeriodo = useCallback(
    (p) => router.push({ pathname: "/matriz/periodo/[id]", params: { id: String(p.id) } }),
    [router],
  );
  const abrirDia = useCallback(
    (iso) => router.push({ pathname: "/matriz/dia/[fecha]", params: { fecha: iso } }),
    [router],
  );

  return (
    <View style={estilos.pantalla} testID={`matriz-${actual}`}>
      <Text style={estilos.tituloVista} accessibilityRole="header">
        {TITULOS[actual]}
      </Text>
      {actual === "calendario" ? (
        // Otra zona horaria es otro «hoy»: se vuelve a montar.
        <CalendarioMatriz key={matriz.zona ?? "local"} matriz={matriz} onAbrirDia={abrirDia} />
      ) : (
        <BandejaMatriz
          matriz={matriz}
          permisos={usuario?.permissions ?? []}
          empresaActiva={empresaActiva?.id}
          onAbrirEstado={abrirEstado}
          onAbrirPeriodo={abrirPeriodo}
        />
      )}
    </View>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  tituloVista: CONTROLES.tituloVista,
});
