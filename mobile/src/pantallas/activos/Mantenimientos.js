import { useRouter } from "expo-router";
import { memo, useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { mantenimientosService } from "../../api/servicios";
import { dinero, ESPERA_BUSCAR_MS } from "../../activos/formato";
import {
  cuantosMantenimientos,
  diasFuera,
  estadoDelMantenimiento,
  fechasDelMantenimiento,
  FILTROS_DE_MANTENIMIENTOS,
  filtroDeMantenimientos,
  nombreDeFilaMantenimiento,
  parametrosDeMantenimientos,
  TIPOS_DE_MANTENIMIENTO,
} from "../../activos/mantenimientos";
import { useBusquedaConEspera, useListaPaginada } from "../../activos/useListaPaginada";
import { Boton } from "../../componentes/comunes";
import { AREA_TACTIL } from "../../tema/colores";
import { useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { Pildora } from "../soporte/piezas";
import { BuscadorDeLista, ChipsDeFiltro, ListaPaginada } from "./listas";

const FILTROS_DE_TIPO = [{ clave: "", texto: "Todos los tipos" }, ...TIPOS_DE_MANTENIMIENTO.map((t) => ({ clave: t.valor, texto: t.texto }))];

/** La ruta del detalle de un mantenimiento (CA-13). `empresa`: la de un
 * aviso. */
export function rutaDelMantenimiento(m, empresa) {
  const params = { id: String(m?.id ?? m) };
  if (empresa) params.empresa = String(empresa);
  return { pathname: "/mantenimientos/[id]", params };
}

/**
 * Un mantenimiento en una lista (CA-13; también en la bitácora de la ficha,
 * CA-7): el activo, el tipo, abierto o cerrado (texto e ícono), las fechas,
 * los días fuera de operación y el costo. Toda la fila abre su detalle.
 * `conActivo`: en la ficha ya se sabe de qué equipo es.
 */
export const FilaDeMantenimiento = memo(function FilaDeMantenimiento({ m, onAbrir, conActivo = true }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const estado = estadoDelMantenimiento(m);
  const dias = diasFuera(m);
  return (
    <Pressable
      testID={`mantenimiento-${m.id}`}
      onPress={() => onAbrir(m)}
      accessibilityRole="button"
      accessibilityLabel={conActivo ? nombreDeFilaMantenimiento(m) : nombreDeFilaMantenimiento({ ...m, activo_codigo: null, activo_nombre: null })}
      accessibilityHint="Abre el detalle del mantenimiento"
      style={({ pressed }) => [estilos.fila, pressed && estilos.presionada]}
    >
      {conActivo ? (
        <Text style={estilos.codigo}>{[m.activo_codigo, m.activo_nombre].filter(Boolean).join(" · ")}</Text>
      ) : null}
      <View style={estilos.filaCabecera}>
        <Text style={estilos.titulo}>{m.tipo_display || m.tipo}</Text>
        <Pildora texto={estado.texto} tono={estado} />
      </View>
      <Text style={estilos.dato}>{fechasDelMantenimiento(m)}</Text>
      {dias ? <Text style={estilos.tenue}>{dias}</Text> : null}
      {m.descripcion ? <Text style={estilos.dato}>{m.descripcion}</Text> : null}
      <Text style={estilos.tenue}>
        {[`Costo: ${dinero(m.costo_total)}`, m.registrado_por_nombre ? `Registró: ${m.registrado_por_nombre}` : null]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </Pressable>
  );
});

/**
 * La bitácora de mantenimientos (US-022, CA-13): `GET mantenimientos/` de a
 * 20, con abiertos y cerrados (`pendientes`), el tipo y la búsqueda con 400
 * ms de espera. Tocar una fila abre su detalle. Con
 * `mantenimientos.registrar`, «Registrar mantenimiento» arriba (eligiendo el
 * activo). `filtro` y `vez`: los de un aviso de reparaciones sin cerrar.
 */
export function Mantenimientos({ filtro: filtroPedido, vez, permisos = [], empresa, versionEmpresa }) {
  const router = useRouter();
  const [filtro, setFiltro] = useState(() => filtroDeMantenimientos(filtroPedido).clave);
  const [tipo, setTipo] = useState("");
  const { texto, setTexto, busqueda, limpiar, ya } = useBusquedaConEspera(ESPERA_BUSCAR_MS);

  useEffect(() => {
    if (filtroPedido === undefined) return;
    setFiltro(filtroDeMantenimientos(filtroPedido).clave);
    setTipo("");
    limpiar();
  }, [filtroPedido, vez, limpiar]);

  const pedir = useCallback(
    (pagina) => mantenimientosService.listar(parametrosDeMantenimientos({ filtro, tipo, q: busqueda, pagina })),
    [filtro, tipo, busqueda],
  );
  const paginada = useListaPaginada(pedir, {
    recargarCon: [empresa, versionEmpresa],
    textos: {
      cargar: "No se pudo cargar la bitácora de mantenimientos.",
      actualizar: "No se pudo actualizar la bitácora.",
      mas: "No se pudieron cargar más mantenimientos.",
    },
  });

  const abrir = useCallback((m) => router.push(rutaDelMantenimiento(m)), [router]);
  const renderItem = useCallback(({ item }) => <FilaDeMantenimiento m={item} onAbrir={abrir} />, [abrir]);
  const puedeRegistrar = permisos.includes("mantenimientos.registrar");

  return (
    <ListaPaginada
      testID="mantenimientos"
      paginada={paginada}
      renderItem={renderItem}
      iconoVacio="tools"
      total={cuantosMantenimientos(paginada.lista.total)}
      textos={{
        cargando: "Cargando la bitácora…",
        vacio: busqueda ? `Ningún mantenimiento coincide con «${busqueda}».` : "No hay mantenimientos con este filtro.",
        verMas: "Ver más mantenimientos",
        cargandoMas: "Cargando más mantenimientos…",
      }}
      cabecera={
        <>
          {puedeRegistrar ? (
            <Boton
              testID="registrar-desde-la-lista"
              titulo="Registrar mantenimiento"
              icono="plus-circle-outline"
              onPress={() => router.push("/mantenimientos/nuevo")}
            />
          ) : null}
          {/* UX H-01: en el sitio, lo rápido es leer la etiqueta del equipo. */}
          {puedeRegistrar ? (
            <Boton
              testID="escanear-desde-la-lista"
              titulo="Escanear la etiqueta"
              icono="barcode-scan"
              variante="secundario"
              onPress={() => router.push("/activos/escanear")}
            />
          ) : null}
          <BuscadorDeLista
            testID="buscar-mantenimiento"
            texto={texto}
            onCambio={setTexto}
            onBuscar={ya}
            etiqueta="Buscar por código, equipo, responsable o descripción"
            placeholder="Código, equipo, responsable o trabajo"
          />
          <ChipsDeFiltro
            filtros={FILTROS_DE_MANTENIMIENTOS}
            valor={filtro}
            onCambio={setFiltro}
            etiqueta="Filtrar por abiertos o cerrados"
          />
          <ChipsDeFiltro filtros={FILTROS_DE_TIPO} valor={tipo} onCambio={setTipo} etiqueta="Filtrar por tipo" prefijo="tipo" />
        </>
      }
    />
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
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
  filaCabecera: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  codigo: { fontSize: 14, fontWeight: "600", color: colores.tintaSuave },
  titulo: { flexShrink: 1, fontSize: 16, fontWeight: "700", color: colores.titulo },
  dato: { fontSize: 15, color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
});
