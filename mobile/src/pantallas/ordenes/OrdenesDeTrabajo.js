import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import { Text, View } from "react-native";

import { Alerta } from "../../componentes/comunes";
import { moduloPorId, vistaActiva } from "../../navegacion/modulos";
import { useContextoDeNavegacion } from "../../navegacion/useContextoDeNavegacion";
import { useSesion } from "../../sesion/SesionContext";
import { colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { crearEstilos } from "../../tema/tipografia";
import { useEmpresaDelAviso } from "../activos/GestionDeActivos";
import { MisOrdenes } from "./MisOrdenes";
import { PanelOrdenes } from "./PanelOrdenes";
import { rutaDeLaOrden } from "./piezas";

const MODULO_ORDENES = moduloPorId("ordenes");

/** El título pequeño de cada vista (H-10 de la US-016). */
const TITULOS = {
  panel: "Panel de mantenimiento",
  mis: "Mis órdenes",
};

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * Órdenes de trabajo en la app (US-025, 17/11/2026): un módulo con su
 * pestaña arriba, a la derecha de Gestión de Activos, y sus vistas en la
 * barra de abajo (CA-1): **Panel** (por defecto) y **Mis órdenes**. «Nueva
 * orden» es una acción: abre su formulario en la pila (`/ordenes/nueva`).
 *
 * La vista sale de `?vista=`; «Mis órdenes» lee además `?pestana=` («mias» o
 * «asignadas»). Un aviso que trae `?empresa=` de otra empresa hace lo mismo
 * que en Gestión de Activos (QA-FUNC B3 de la US-022): la app pasa a ella si
 * es de la persona, o avisa que lo que se ve es de la empresa activa.
 */
export function OrdenesDeTrabajo() {
  const router = useRouter();
  const parametros = useLocalSearchParams();
  const { usuario, empresaActiva, versionEmpresa } = useSesion();
  const contexto = useContextoDeNavegacion();
  const actual = vistaActiva(MODULO_ORDENES, { name: "ordenes", params: parametros }, contexto);
  const permisos = usuario?.permissions ?? [];
  const empresa = empresaActiva?.id ?? null;
  const avisoDeEmpresa = useEmpresaDelAviso(primero(parametros.empresa), primero(parametros.n));

  const abrirOrden = useCallback((orden) => router.push(rutaDeLaOrden(orden)), [router]);

  const contenido =
    actual === "mis" ? (
      <MisOrdenes
        pestanaPedida={primero(parametros.pestana)}
        permisos={permisos}
        empresa={empresa}
        versionEmpresa={versionEmpresa}
        onAbrirOrden={abrirOrden}
      />
    ) : (
      <PanelOrdenes permisos={permisos} empresa={empresa} versionEmpresa={versionEmpresa} onAbrirOrden={abrirOrden} />
    );

  return (
    <View style={estilos.pantalla} testID={`ordenes-${actual}`}>
      <Text style={estilos.tituloVista} accessibilityRole="header">
        {TITULOS[actual] ?? "Órdenes de trabajo"}
      </Text>
      {avisoDeEmpresa ? (
        <View style={estilos.aviso}>
          <Alerta tipo={avisoDeEmpresa.tipo} texto={avisoDeEmpresa.texto} testID="aviso-de-empresa" />
        </View>
      ) : null}
      {contenido}
    </View>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  tituloVista: CONTROLES.tituloVista,
  aviso: { paddingHorizontal: 16, paddingTop: 8 },
});
