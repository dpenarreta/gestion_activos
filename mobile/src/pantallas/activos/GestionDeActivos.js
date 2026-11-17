import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { veLosActivos } from "../../activos/formato";
import { BotonFlotante } from "../../componentes/BotonFlotante";
import { moduloPorId, vistaActiva } from "../../navegacion/modulos";
import { useContextoDeNavegacion } from "../../navegacion/useContextoDeNavegacion";
import { anunciar } from "../../accesibilidad/anunciar";
import { Alerta } from "../../componentes/comunes";
import { useSesion } from "../../sesion/SesionContext";
import { useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { Inventario } from "./Inventario";
import { Mantenimientos } from "./Mantenimientos";
import { PanelActivos } from "./PanelActivos";
import { ListaDeSolicitudes } from "./Solicitudes";

const MODULO_ACTIVOS = moduloPorId("activos");

/** El título pequeño de cada vista (H-10 de la US-016). */
const TITULOS = {
  panel: "Panel",
  inventario: "Inventario",
  mantenimientos: "Mantenimientos",
  mis_solicitudes: "Mis solicitudes",
  recibidas: "Solicitudes recibidas",
};

function primero(valor) {
  return Array.isArray(valor) ? valor[0] : valor;
}

export function textoAvisoDeOtraEmpresa(nombre) {
  return `Este aviso es de ${nombre}: la app pasó a esa empresa.`;
}
export const TEXTO_AVISO_SIN_ACCESO =
  "Este aviso es de una empresa a la que ya no tiene acceso: lo que ve abajo es de su empresa activa, no la del aviso.";

/**
 * QA-FUNC B3: un aviso que abre una lista (`?empresa=` en la ruta) de una
 * empresa que no es la activa hace lo mismo que el detalle de una
 * notificación (B3 de la US-009, `DetalleNotificacion`): si es una empresa de
 * la persona, la app pasa a ella y lo dice; si no, avisa que lo que se ve es
 * de la empresa activa. Nunca se muestran sin aviso los datos de otra
 * empresa. Se atiende una vez por toque (`?n=`). Exportado desde la US-025:
 * Órdenes de trabajo hace lo mismo con sus avisos.
 */
export function useEmpresaDelAviso(empresa, vez) {
  const { empresaActiva, empresas, cambiarEmpresaSiEsSuya } = useSesion();
  const [aviso, setAviso] = useState(null);
  const atendido = useRef(null);
  const activa = empresaActiva?.id ?? null;

  useEffect(() => {
    const clave = `${empresa ?? ""}|${vez ?? ""}`;
    if (!empresa || !/^\d{1,12}$/.test(String(empresa)) || atendido.current === clave) return;
    atendido.current = clave;
    if (String(empresa) === String(activa ?? "")) {
      setAviso(null);
      return;
    }
    const lista = Array.isArray(empresas) ? empresas : [];
    const suya = lista.find((e) => String(e.id) === String(empresa));
    if (!suya || typeof cambiarEmpresaSiEsSuya !== "function") {
      setAviso({ tipo: "aviso", texto: TEXTO_AVISO_SIN_ACCESO });
      return;
    }
    const texto = textoAvisoDeOtraEmpresa(suya.nombre ?? "otra empresa");
    setAviso({ tipo: "info", texto });
    anunciar(texto);
    cambiarEmpresaSiEsSuya(empresa).catch(() => setAviso({ tipo: "aviso", texto: TEXTO_AVISO_SIN_ACCESO }));
  }, [empresa, vez, activa, empresas, cambiarEmpresaSiEsSuya]);

  return aviso;
}

/**
 * Gestión de Activos en la app (US-022, 16/11/2026): un módulo con su
 * pestaña arriba, a la derecha de la Matriz, y sus vistas en la barra de
 * abajo, según los permisos (CA-1): **Panel** (por defecto), **Inventario**,
 * **Mantenimientos**, **Mis solicitudes** y **Recibidas**. «Escanear» es una
 * acción: abre su pantalla en la pila (`/activos/escanear`) para que la
 * cámara se apague al salir.
 *
 * La vista sale de `?vista=`. El inventario y la bitácora leen además
 * `?filtro=` (el de la tarjeta del panel o del aviso) y `?n=` (cambia en cada
 * toque para volver a aplicarlo).
 *
 * Tanda B (16/11/2026): la bitácora de mantenimientos (CA-13), «Mis
 * solicitudes» (CA-18) y «Recibidas» (CA-20). Sus detalles y formularios van
 * en la pila (`/mantenimientos/…`, `/solicitudes/…`).
 */
export function GestionDeActivos() {
  const estilos = useEstilos(fabricaDeEstilos);
  const router = useRouter();
  const parametros = useLocalSearchParams();
  const { usuario, empresaActiva, versionEmpresa } = useSesion();
  const contexto = useContextoDeNavegacion();
  const actual = vistaActiva(MODULO_ACTIVOS, { name: "activos", params: parametros }, contexto);
  const permisos = usuario?.permissions ?? [];
  const empresa = empresaActiva?.id ?? null;
  const avisoDeEmpresa = useEmpresaDelAviso(primero(parametros.empresa), primero(parametros.n));

  const abrirInventario = useCallback(
    (filtro) => router.setParams({ vista: "inventario", filtro, n: String(Date.now()) }),
    [router],
  );
  const abrirActivo = useCallback(
    (activo) => router.push({ pathname: "/activos/[id]", params: { id: String(activo?.id ?? activo) } }),
    [router],
  );

  let contenido;
  if (actual === "inventario") {
    contenido = (
      <Inventario
        filtro={primero(parametros.filtro)}
        vez={primero(parametros.n)}
        empresa={empresa}
        versionEmpresa={versionEmpresa}
        permisos={permisos}
        onAbrirActivo={abrirActivo}
      />
    );
  } else if (actual === "mantenimientos") {
    contenido = (
      <Mantenimientos
        filtro={primero(parametros.filtro)}
        vez={primero(parametros.n)}
        permisos={permisos}
        empresa={empresa}
        versionEmpresa={versionEmpresa}
      />
    );
  } else if (actual === "mis_solicitudes" || actual === "recibidas") {
    contenido = (
      <ListaDeSolicitudes
        key={actual}
        ambito={actual === "recibidas" ? "recibidas" : "mias"}
        permisos={permisos}
        empresa={empresa}
        versionEmpresa={versionEmpresa}
      />
    );
  } else {
    contenido = (
      <PanelActivos
        permisos={permisos}
        empresa={empresa}
        versionEmpresa={versionEmpresa}
        onAbrirInventario={abrirInventario}
        onAbrirActivo={abrirActivo}
      />
    );
  }

  return (
    <View style={estilos.pantalla} testID={`activos-${actual}`}>
      <Text style={estilos.tituloVista} accessibilityRole="header">
        {TITULOS[actual] ?? "Gestión de Activos"}
      </Text>
      {avisoDeEmpresa ? (
        <View style={estilos.aviso}>
          <Alerta tipo={avisoDeEmpresa.tipo} texto={avisoDeEmpresa.texto} testID="aviso-de-empresa" />
        </View>
      ) : null}
      {contenido}
      {/* La burbuja de «Escanear» (16/11/2026, a pedido del usuario): solo en
          Gestión de Activos, en todas sus vistas, y con el permiso del escáner
          de la web (`activos.ver`, el de su ruta y su menú). Abre el escáner
          con la cámara ya lista (`auto`). */}
      {veLosActivos(permisos) ? (
        <BotonFlotante
          testID="escanear-flotante"
          icono="barcode-scan"
          etiqueta="Escanear la etiqueta de un activo"
          pista="Abre la cámara para leer el código QR o de barras"
          onPress={() => router.push({ pathname: "/activos/escanear", params: { auto: "1" } })}
        />
      ) : null}
    </View>
  );
}

const fabricaDeEstilos = (colores, CONTROLES) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  tituloVista: CONTROLES.tituloVista,
  aviso: { paddingHorizontal: 16, paddingTop: 8 },
});
