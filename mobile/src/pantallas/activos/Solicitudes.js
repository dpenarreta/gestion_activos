import { useRouter } from "expo-router";
import { memo, useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { solicitudesService } from "../../api/servicios";
import { ESPERA_BUSCAR_MS, puedePedirEquipos } from "../../activos/formato";
import {
  cuantasSolicitudes,
  estadoDeSolicitud,
  fechaDePedido,
  FILTROS_DE_SOLICITUDES,
  nombreDeFilaSolicitud,
  parametrosDeSolicitudes,
  prioridadDe,
  queSePide,
} from "../../activos/solicitudes";
import { useBusquedaConEspera, useListaPaginada } from "../../activos/useListaPaginada";
import { Boton } from "../../componentes/comunes";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { fechaCorta } from "../../utils/fechas";
import { Pildora } from "../soporte/piezas";
import { BuscadorDeLista, ChipsDeFiltro, ListaPaginada } from "./listas";

/** La ruta del detalle de una solicitud de equipo. `empresa`: la de un
 * aviso. */
export function rutaDeLaSolicitud(s, empresa) {
  const params = { id: String(s?.id ?? s) };
  if (empresa) params.empresa = String(empresa);
  return { pathname: "/solicitudes/[id]", params };
}

/**
 * Una solicitud en una lista (CA-18, CA-20): qué se pidió, el estado (texto
 * e ícono), la prioridad, el encargado (o quien la pidió, en «Recibidas») y
 * las fechas. Toda la fila abre su detalle.
 */
export const FilaDeSolicitud = memo(function FilaDeSolicitud({ s, ambito, onAbrir }) {
  const estado = estadoDeSolicitud(s.estado, s.estado_display);
  const prioridad = prioridadDe(s);
  const persona = ambito === "recibidas" ? `Pidió: ${s.solicitante_nombre || "—"}` : `Encargado: ${s.encargado_nombre || "—"}`;
  return (
    <Pressable
      testID={`solicitud-${s.id}`}
      onPress={() => onAbrir(s)}
      accessibilityRole="button"
      accessibilityLabel={nombreDeFilaSolicitud(s, ambito)}
      accessibilityHint="Abre el detalle de la solicitud"
      style={({ pressed }) => [estilos.fila, pressed && estilos.presionada]}
    >
      <Text style={estilos.numero}>{`Solicitud #${s.id}`}</Text>
      <Text style={estilos.titulo}>{queSePide(s)}</Text>
      <View style={estilos.pildoras}>
        <Pildora texto={estado.texto} tono={estado} />
        {prioridad ? <Pildora texto={prioridad.texto} tono={prioridad} /> : null}
      </View>
      <Text style={estilos.dato}>{persona}</Text>
      <Text style={estilos.tenue}>
        {[
          fechaDePedido(s) ? `Pedida el ${fechaDePedido(s)}` : null,
          s.fecha_necesaria ? `para el ${fechaCorta(s.fecha_necesaria)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </Pressable>
  );
});

const TEXTOS = {
  mias: {
    cargar: "No se pudieron cargar sus solicitudes.",
    actualizar: "No se pudieron actualizar sus solicitudes.",
    mas: "No se pudieron cargar más solicitudes.",
    cargando: "Cargando sus solicitudes…",
    vacia: "No tiene solicitudes con este filtro.",
  },
  recibidas: {
    cargar: "No se pudieron cargar las solicitudes recibidas.",
    actualizar: "No se pudieron actualizar las solicitudes recibidas.",
    mas: "No se pudieron cargar más solicitudes.",
    cargando: "Cargando las solicitudes recibidas…",
    vacia: "No hay solicitudes recibidas con este filtro.",
  },
};

/**
 * «Mis solicitudes» (CA-18, `ambito=mias`) y «Recibidas» (CA-20,
 * `ambito=recibidas`): `GET solicitudes/` de a 20, «Abiertas» (por defecto)
 * o «Todas», y búsqueda con 400 ms de espera. En «Mis solicitudes», con
 * `solicitudes.crear`, «Nueva solicitud» arriba (CA-19).
 */
export function ListaDeSolicitudes({ ambito = "mias", permisos = [], empresa, versionEmpresa }) {
  const router = useRouter();
  const [filtro, setFiltro] = useState("abiertas");
  const { texto, setTexto, busqueda, ya } = useBusquedaConEspera(ESPERA_BUSCAR_MS);
  const textos = TEXTOS[ambito] ?? TEXTOS.mias;

  const pedir = useCallback(
    (pagina) => solicitudesService.listar(parametrosDeSolicitudes({ ambito, filtro, q: busqueda, pagina })),
    [ambito, filtro, busqueda],
  );
  const paginada = useListaPaginada(pedir, { recargarCon: [empresa, versionEmpresa], textos });

  const abrir = useCallback((s) => router.push(rutaDeLaSolicitud(s)), [router]);
  const renderItem = useCallback(({ item }) => <FilaDeSolicitud s={item} ambito={ambito} onAbrir={abrir} />, [abrir, ambito]);
  const puedePedir = ambito === "mias" && puedePedirEquipos(permisos);

  return (
    <ListaPaginada
      testID={`solicitudes-${ambito}`}
      paginada={paginada}
      renderItem={renderItem}
      iconoVacio={ambito === "recibidas" ? "inbox-arrow-down-outline" : "cart-outline"}
      total={cuantasSolicitudes(paginada.lista.total)}
      textos={{
        cargando: textos.cargando,
        vacio: busqueda ? `Ninguna solicitud coincide con «${busqueda}».` : textos.vacia,
        verMas: "Ver más solicitudes",
        cargandoMas: "Cargando más solicitudes…",
      }}
      cabecera={
        <>
          {puedePedir ? (
            <Boton
              testID="nueva-solicitud"
              titulo="Nueva solicitud"
              icono="cart-plus"
              onPress={() => router.push("/solicitudes/nueva")}
            />
          ) : null}
          <BuscadorDeLista
            testID={`buscar-solicitud-${ambito}`}
            texto={texto}
            onCambio={setTexto}
            onBuscar={ya}
            etiqueta="Buscar por lo que se pidió, la justificación o la persona"
            placeholder="Qué se pidió o quién"
          />
          <ChipsDeFiltro filtros={FILTROS_DE_SOLICITUDES} valor={filtro} onCambio={setFiltro} etiqueta="Filtrar por abiertas o todas" />
        </>
      }
    />
  );
}

const estilos = crearEstilos({
  fila: {
    minHeight: AREA_TACTIL,
    padding: 14,
    gap: 4,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  presionada: { backgroundColor: colores.realce },
  numero: { fontSize: 14, fontWeight: "600", color: colores.tintaSuave },
  titulo: { fontSize: 16, fontWeight: "700", color: colores.titulo },
  pildoras: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  dato: { fontSize: 15, color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
});
