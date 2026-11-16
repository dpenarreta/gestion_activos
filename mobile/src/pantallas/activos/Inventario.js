import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { activosService } from "../../api/servicios";
import {
  cuantosActivos,
  ESPERA_BUSCAR_MS,
  FILTROS_DEL_INVENTARIO,
  filtroDelInventario,
  parametrosDelInventario,
  puedeRegistrarActivos,
} from "../../activos/formato";
import { useBusquedaConEspera, useListaPaginada } from "../../activos/useListaPaginada";
import { Boton, BotonIcono } from "../../componentes/comunes";
import { BuscadorDeLista, ChipsDeFiltro, ListaPaginada } from "./listas";
import { FilaActivo } from "./piezas";

const TEXTOS = {
  cargar: "No se pudo cargar el inventario.",
  actualizar: "No se pudo actualizar el inventario.",
  mas: "No se pudieron cargar más activos.",
};

/**
 * El inventario (US-022, CA-6): `GET activos/` de a 20, con más al llegar al
 * final o con «Ver más», búsqueda `q` con una espera de 400 ms y los chips
 * de estado (Todos, Asignados, En almacén, En reparación y Fuera de
 * inventario). Las tarjetas del panel lo abren con su filtro (`filtro` y
 * `vez`, que cambia en cada toque para volver a aplicarlo).
 *
 * Desde la ronda 1 de QA (UX H-17) usa las mismas piezas que la bitácora y
 * las solicitudes (`useListaPaginada`, `ListaPaginada`): se refresca al
 * tirar hacia abajo y al volver a él, al cambiar de empresa empieza de cero
 * (CA-22) y, al buscar, lo anterior se queda a la vista mientras carga
 * (H-19). Junto al buscador, el escáner a un toque (UX H-01).
 *
 * Con `activos.crear`, «Registrar activo» arriba (US-023, CA-1), en la app y
 * ya no en el navegador.
 */
export function Inventario({ filtro: filtroPedido, vez, versionEmpresa, empresa, permisos = [], onAbrirActivo }) {
  const router = useRouter();
  const [filtro, setFiltro] = useState(() => filtroDelInventario(filtroPedido).clave);
  const { texto, setTexto, busqueda, limpiar, ya } = useBusquedaConEspera(ESPERA_BUSCAR_MS);

  // Una tarjeta del panel (o un aviso) pide otro filtro: se aplica y se
  // limpia la búsqueda, aunque sea el mismo de antes (`vez`).
  useEffect(() => {
    if (filtroPedido === undefined) return;
    setFiltro(filtroDelInventario(filtroPedido).clave);
    limpiar();
  }, [filtroPedido, vez, limpiar]);

  const pedir = useCallback(
    (pagina) => activosService.listar(parametrosDelInventario({ filtro, q: busqueda, pagina })),
    [filtro, busqueda],
  );
  const paginada = useListaPaginada(pedir, { recargarCon: [empresa, versionEmpresa], textos: TEXTOS });
  const renderItem = useCallback(({ item }) => <FilaActivo activo={item} onAbrir={onAbrirActivo} />, [onAbrirActivo]);

  return (
    <ListaPaginada
      testID="inventario"
      testIDTotal="total-de-activos"
      paginada={paginada}
      renderItem={renderItem}
      iconoVacio="monitor-off"
      total={cuantosActivos(paginada.lista.total)}
      textos={{
        cargando: "Cargando el inventario…",
        vacio: busqueda ? `Ningún activo coincide con «${busqueda}».` : "No hay activos con este filtro.",
        verMas: "Ver más activos",
        cargandoMas: "Cargando más activos…",
      }}
      cabecera={
        <>
          {puedeRegistrarActivos(permisos) ? (
            <Boton
              testID="registrar-activo-desde-el-inventario"
              titulo="Registrar activo"
              icono="plus-circle-outline"
              onPress={() => router.push("/activos/nuevo")}
            />
          ) : null}
          <BuscadorDeLista
            testID="buscar-activo"
            texto={texto}
            onCambio={setTexto}
            onBuscar={ya}
            etiqueta="Buscar por código, serie, nombre o responsable"
            placeholder="Código, serie, nombre o responsable"
            accion={
              <BotonIcono
                testID="escanear-desde-inventario"
                icono="barcode-scan"
                variante="contorno"
                etiqueta="Escanear la etiqueta"
                onPress={() => router.push("/activos/escanear")}
              />
            }
          />
          <ChipsDeFiltro filtros={FILTROS_DEL_INVENTARIO} valor={filtro} onCambio={setFiltro} etiqueta="Filtrar por estado" />
        </>
      }
    />
  );
}
