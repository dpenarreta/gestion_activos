import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { activosService } from "../../../api/activosService";
import { matrizService } from "../../../api/matrizService";
import { useBusquedaEnVivo } from "../../../hooks/useBusquedaEnVivo";
import { usePermission } from "../../../hooks/usePermission";
import { moduloDeRuta } from "../../../modulos/modulos";
import { BuscadorConSugerencias } from "../../common/BuscadorConSugerencias/BuscadorConSugerencias";
import "./BusquedaGlobal.css";

/*
 * Buscar un equipo desde cualquier pantalla.
 *
 * Es la pregunta que más veces se hace al día —«dónde está este aparato»— y
 * hasta ahora obligaba a ir primero al inventario. Vive en la barra superior,
 * a la vista en todo `/admin`, con el dibujo del buscador de la identidad base.
 *
 * Dos caminos según lo que se escriba, y el orden importa:
 *
 * 1. Si lo tecleado es la etiqueta o el número de serie de un equipo, se abre
 *    su ficha directamente. Es lo que pasa al pistolear una etiqueta, que
 *    termina en un Enter: ahí nadie quiere un listado de un elemento.
 * 2. Si no corresponde a ninguno, se abre el inventario buscando ese texto.
 *    Así «Jorge» o «ThinkPad» llevan a la lista filtrada en vez de a un error.
 *
 * Mientras se escribe (búsqueda en vivo, 06/11/2026) no se navega: debajo
 * del campo aparecen los equipos que coinciden, para abrir uno con las
 * flechas y Enter o con un clic. Enter sin ninguno marcado sigue los dos
 * caminos de arriba, así que la pistola funciona igual que antes.
 */

/** Cuántas sugerencias caben sin tapar la pantalla. */
const SUGERENCIAS = 6;

/** Las primeras y cuántas hay en total, para anunciar «6 de 12». */
const sugerenciasDe = (datos) => {
  const lista = datos.results ?? datos;
  return {
    resultados: lista.slice(0, SUGERENCIAS),
    total: datos.count ?? lista.length,
  };
};
/** La lista de obligaciones, que es donde se filtra en vivo. */
const LISTA_DE_LA_MATRIZ = "/admin/matriz/obligaciones";

/**
 * En la Matriz, la barra busca obligaciones (§15.1). Busca en el nombre, el
 * código, el período, el responsable, la entidad y el área.
 *
 * Estando ya en la lista, filtra en vivo: al dejar de escribir actualiza
 * `?q=` conservando los demás filtros y sin apilar historial. Desde cualquier
 * otra pantalla de la Matriz no navega a mitad de escribir (auditoría UX/UI,
 * fase 3, 28/10/2026): sugiere los períodos que coinciden y Enter abre la
 * lista buscando ese texto (búsqueda en vivo, 06/11/2026).
 */
function BusquedaEnLaMatriz() {
  const { pathname } = useLocation();
  if (pathname === LISTA_DE_LA_MATRIZ) return <FiltroDeLaMatriz />;
  return <SugerenciasDeLaMatriz />;
}

function FiltroDeLaMatriz() {
  const [params, setParams] = useSearchParams();
  const busqueda = useBusquedaEnVivo({
    // Arranca con lo que ya filtra la lista: vaciar el campo la limpia.
    inicial: params.get("q") ?? "",
    alBuscar: (q) =>
      setParams(
        (actuales) => {
          const nuevos = new URLSearchParams(actuales);
          if (q) nuevos.set("q", q);
          else nuevos.delete("q");
          return nuevos;
        },
        { replace: true },
      ),
  });

  return (
    <form
      className="mz-search busqueda-global"
      role="search"
      onSubmit={(evento) => {
        evento.preventDefault();
        busqueda.buscarYa();
      }}
    >
      <label className="visually-hidden" htmlFor="busqueda-global">
        Buscar en la matriz
      </label>
      <i className="bi bi-search" aria-hidden="true" />
      <input
        id="busqueda-global"
        type="search"
        placeholder="Buscar obligación, responsable, código…"
        autoComplete="off"
        {...busqueda.propsCampo}
      />
    </form>
  );
}

function SugerenciasDeLaMatriz() {
  const navigate = useNavigate();
  const abrirLista = (q) =>
    navigate(`${LISTA_DE_LA_MATRIZ}?q=${encodeURIComponent(q)}`);
  return (
    <BuscadorConSugerencias
      etiqueta="Buscar en la matriz"
      placeholder="Buscar obligación, responsable, código…"
      icono="search"
      buscar={(q) =>
        matrizService
          .periodos({ q, page_size: SUGERENCIAS })
          .then(sugerenciasDe)
      }
      claveDe={(periodo) => periodo.id}
      contenidoDe={(periodo) => (
        <>
          <span className="mz-mono">{periodo.codigo}</span>{" "}
          {periodo.obligacion?.nombre}
          <small>
            {[periodo.area, periodo.responsable?.nombre]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </>
      )}
      // El período se abre en el panel lateral de la lista, como al hacer
      // clic en su fila.
      alElegir={(periodo) =>
        navigate(`${LISTA_DE_LA_MATRIZ}?periodo=${periodo.id}`)
      }
      alConfirmar={abrirLista}
      textoVerTodos={(q) => `Ver todos los períodos con «${q}»`}
      alVerTodos={abrirLista}
      textoSinSugerencias={(q) =>
        `Sin sugerencias para «${q}». Pulse Enter para buscarlo en la matriz.`
      }
    />
  );
}

/**
 * El buscador de la barra superior, según el módulo de la pantalla abierta:
 * escanear o buscar un código solo dentro de Gestión de Activos, y buscar
 * obligaciones dentro de la Matriz. En los demás módulos y en las pantallas
 * comunes (Configuración, Mi perfil…) no hay buscador (21/10/2026).
 */
export function BusquedaGlobal() {
  const { pathname } = useLocation();
  const modulo = moduloDeRuta(pathname);
  if (modulo === "activos") return <BusquedaDeActivos />;
  if (modulo === "matriz") return <BusquedaEnLaMatriz />;
  return null;
}

function BusquedaDeActivos() {
  const puedeVer = usePermission("activos.ver");
  const navigate = useNavigate();

  if (!puedeVer) {
    // Quien no ve el inventario tampoco puede buscar en él: ofrecerlo acabaría
    // en un 403 o en un listado vacío que parece un fallo.
    return null;
  }

  const abrirInventario = (valor) =>
    navigate(`/admin/activos?q=${encodeURIComponent(valor)}`);

  async function confirmar(valor) {
    try {
      const datos = await activosService.porCodigo(valor);
      navigate(`/admin/activos/${datos.activo.id}`);
    } catch {
      // Cualquier fallo cae al listado: un 404 es lo normal al buscar por
      // nombre, y si el servidor falló de verdad el listado lo dirá con su
      // propio mensaje en vez de dejar la cabecera en silencio.
      abrirInventario(valor);
    }
  }

  return (
    <BuscadorConSugerencias
      etiqueta="Buscar un equipo"
      placeholder="Escanee o busque: código, serie, equipo o persona"
      icono="upc-scan"
      buscar={(q) =>
        activosService.list({ q, page_size: SUGERENCIAS }).then(sugerenciasDe)
      }
      claveDe={(activo) => activo.id}
      contenidoDe={(activo) => (
        <>
          <code className="codigo-barras">{activo.codigo_barras}</code>{" "}
          {activo.nombre}
          <small>
            {[
              [activo.marca, activo.modelo].filter(Boolean).join(" "),
              activo.numero_serie,
              activo.responsables_resumen,
            ]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </>
      )}
      alElegir={(activo) => navigate(`/admin/activos/${activo.id}`)}
      alConfirmar={confirmar}
      textoVerTodos={(q) =>
        `Ver todos los resultados de «${q}» en el inventario`
      }
      alVerTodos={abrirInventario}
      textoSinSugerencias={(q) =>
        `Sin sugerencias para «${q}». Pulse Enter para buscarlo en el inventario.`
      }
    />
  );
}
