import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { activosService } from "../../../api/activosService";
import { usePermission } from "../../../hooks/usePermission";
import { moduloDeRuta } from "../../../modulos/modulos";
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
 */
/** La lista de obligaciones, que es donde se filtra en vivo. */
const LISTA_DE_LA_MATRIZ = "/admin/matriz/obligaciones";

/**
 * En la Matriz, la barra busca obligaciones (§15.1). Busca en el nombre, el
 * código, el período, el responsable, la entidad y el área.
 *
 * Estando ya en la lista, filtra en vivo: tras 250 ms sin escribir actualiza
 * `?q=`. Desde cualquier otra pantalla de la Matriz espera al Enter: antes
 * también saltaba a la lista a los 250 ms, y a mitad de escribir se perdía la
 * pantalla en la que se estaba (auditoría UX/UI, fase 3, 28/10/2026).
 */
function BusquedaEnLaMatriz() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const enLaLista = pathname === LISTA_DE_LA_MATRIZ;
  const [termino, setTermino] = useState("");
  const temporizador = useRef(null);

  useEffect(() => () => clearTimeout(temporizador.current), []);

  function abrir(valor) {
    navigate(`${LISTA_DE_LA_MATRIZ}?q=${encodeURIComponent(valor.trim())}`);
  }

  return (
    <form
      className="mz-search busqueda-global"
      role="search"
      onSubmit={(evento) => {
        evento.preventDefault();
        clearTimeout(temporizador.current);
        abrir(termino);
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
        value={termino}
        autoComplete="off"
        onChange={(evento) => {
          const valor = evento.target.value;
          setTermino(valor);
          clearTimeout(temporizador.current);
          if (enLaLista) {
            temporizador.current = setTimeout(() => abrir(valor), 250);
          }
        }}
      />
    </form>
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
  const [termino, setTermino] = useState("");
  const [isBuscando, setIsBuscando] = useState(false);

  if (!puedeVer) {
    // Quien no ve el inventario tampoco puede buscar en él: ofrecerlo acabaría
    // en un 403 o en un listado vacío que parece un fallo.
    return null;
  }

  async function handleSubmit(evento) {
    evento.preventDefault();
    const valor = termino.trim();
    if (!valor) return;

    setIsBuscando(true);
    try {
      const datos = await activosService.porCodigo(valor);
      navigate(`/admin/activos/${datos.activo.id}`);
    } catch {
      // Cualquier fallo cae al listado: un 404 es lo normal al buscar por
      // nombre, y si el servidor falló de verdad el listado lo dirá con su
      // propio mensaje en vez de dejar la cabecera en silencio.
      navigate(`/admin/activos?q=${encodeURIComponent(valor)}`);
    } finally {
      setIsBuscando(false);
      setTermino("");
    }
  }

  return (
    <form
      className="mz-search busqueda-global"
      onSubmit={handleSubmit}
      role="search"
    >
      <label className="visually-hidden" htmlFor="busqueda-global">
        Buscar un equipo
      </label>
      <i className="bi bi-upc-scan" aria-hidden="true" />
      <input
        id="busqueda-global"
        type="search"
        placeholder="Escanee o busque: código, serie, equipo o persona"
        value={termino}
        onChange={(evento) => setTermino(evento.target.value)}
        disabled={isBuscando}
        autoComplete="off"
      />
    </form>
  );
}
