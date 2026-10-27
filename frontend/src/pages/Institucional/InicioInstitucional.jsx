import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { institucionalService } from "../../api/institucionalService";
import { misDatosService } from "../../api/misDatosService";
import { modulosConAcceso } from "../../components/admin/AdminSidebar/staticAdminMenu";
import { Icon } from "../../components/common/Icon/Icon";
import { useUnsavedChanges } from "../../context/UnsavedChangesContext";
import { useAuth } from "../../hooks/useAuth";
import { MODULOS, recordarModulo } from "../../modulos/modulos";
import { CalendarioInicio } from "./CalendarioInicio";
import { CarruselNoticias } from "./CarruselNoticias";
import "./Institucional.css";

/** Lo que toda persona con sesión puede abrir, sin permisos. */
const ACCESOS = [
  {
    to: "/admin/ayuda",
    icono: "headset",
    nombre: "Soporte TI",
    texto: "Pedir ayuda y seguir sus tickets",
  },
  {
    to: "/admin/chat",
    icono: "chat-dots",
    nombre: "Chat",
    texto: "Canal general, mensajes directos y grupos",
  },
  {
    to: "/admin/institucional/codigos",
    icono: "journal-text",
    nombre: "Códigos de conducta",
    texto: "Las normas de conducta y disciplinarias de la empresa",
  },
  {
    to: "/admin/institucional/permisos",
    icono: "calendar-check",
    nombre: "Solicitud de permisos",
    texto: "Pedir permisos y aprobar los que le toquen",
  },
  {
    to: "/admin/institucional/vacaciones",
    icono: "sun",
    nombre: "Mis vacaciones",
    texto: "Días pendientes de gozar, por período",
  },
  {
    to: "/admin/perfil",
    icono: "person-vcard",
    nombre: "Mi perfil",
    texto: "Su información personal y su cargo",
  },
];

/**
 * Institucional → Inicio: a donde entra toda persona al iniciar sesión,
 * siempre (decidido el 19/10/2026). No pide permisos: saluda, dice su cargo,
 * ofrece lo que cualquiera puede usar y los módulos a los que tiene acceso.
 */
export function InicioInstitucional() {
  const { user } = useAuth();
  const { guardedNavigate } = useUnsavedChanges();
  const [perfil, setPerfil] = useState(null);
  const [noticias, setNoticias] = useState([]);
  const [segundos, setSegundos] = useState(6);
  // «cargando», «listo» o «error»: mientras carga o si falla no se dice «no
  // hay noticias», que sería falso (auditoría UX/UI, 27/10/2026).
  const [estadoNoticias, setEstadoNoticias] = useState("cargando");
  // Tras «Reintentar» el botón desaparece: el foco vuelve a la sección y no
  // cae al principio de la página.
  const columnaNoticias = useRef(null);
  const [reintento, setReintento] = useState(false);

  // El carrusel: las noticias vigentes hoy y cada cuántos segundos cambia.
  const cargarNoticias = useCallback(() => {
    let vigente = true;
    setEstadoNoticias("cargando");
    Promise.all([
      Promise.resolve(institucionalService.noticias?.()),
      Promise.resolve(institucionalService.carrusel?.()),
    ])
      .then(([lista, ajustes]) => {
        if (!vigente) return;
        setNoticias(Array.isArray(lista) ? lista : []);
        if (ajustes?.segundos) setSegundos(ajustes.segundos);
        setEstadoNoticias("listo");
      })
      .catch(() => vigente && setEstadoNoticias("error"));
    return () => {
      vigente = false;
    };
  }, []);

  useEffect(() => cargarNoticias(), [cargarNoticias]);

  useEffect(() => {
    if (reintento && estadoNoticias !== "cargando") {
      columnaNoticias.current?.focus();
      setReintento(false);
    }
  }, [reintento, estadoNoticias]);

  useEffect(() => {
    let vigente = true;
    Promise.resolve(misDatosService.obtener?.())
      .then((datos) => vigente && setPerfil(datos ?? null))
      .catch(() => null);
    return () => {
      vigente = false;
    };
  }, []);

  const permisos = user?.permissions || [];
  const disponibles = modulosConAcceso(permisos);
  const modulos = MODULOS.filter(
    (m) => m.id !== "institucional" && disponibles.includes(m.id),
  );
  const veOrganigrama = [
    "institucional.ver",
    "institucional.editar",
    "institucional.asignar",
  ].some((p) => permisos.includes(p));
  const nombre = user?.first_name || perfil?.nombres || user?.username || "";
  const gestionaNoticias = permisos.includes("noticias.gestionar");
  const gestionaCalendario = permisos.includes("calendario.gestionar");

  function abrir(modulo) {
    recordarModulo(modulo.id);
    guardedNavigate(modulo.inicio);
  }

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>{nombre ? `Hola, ${nombre}` : "Bienvenido"}</h2>
          <p className="mz-desc">
            {perfil?.cargo
              ? `${perfil.cargo.nombre}.`
              : "Todavía no tiene un cargo asignado en el organigrama."}{" "}
            {!perfil?.cargo && (
              <Link to="/admin/perfil">Elegirlo en Mi perfil</Link>
            )}
          </p>
        </div>
      </div>

      {/* Noticias y calendario, uno junto al otro, entre el saludo y los
          accesos: es lo primero que se ve al entrar. Cada uno con su botón
          para gestionarlo (y su permiso). */}
      <div className="inicio-destacados">
        <section
          className="inicio-destacados__columna"
          aria-labelledby="inicio-noticias"
          ref={columnaNoticias}
          tabIndex={-1}
        >
          <div className="inicio-destacados__cabecera">
            <h3 id="inicio-noticias" className="inicio-titulo">
              Noticias y eventos
            </h3>
            {gestionaNoticias && (
              <Link
                to="/admin/institucional/noticias"
                className="btn btn-outline-primary btn-sm"
              >
                <Icon name="images" /> Gestionar noticias
              </Link>
            )}
          </div>
          {estadoNoticias === "cargando" ? (
            <div
              className="inicio-esqueleto inicio-esqueleto--carrusel"
              role="status"
            >
              <span className="visually-hidden">Cargando noticias…</span>
            </div>
          ) : estadoNoticias === "error" ? (
            <div
              className="mz-alert mz-alert--bad mz-alert--accion"
              role="alert"
            >
              <Icon name="x-octagon" />
              <span>No pudimos cargar las noticias.</span>
              <button
                type="button"
                className="btn btn-sm btn-outline-danger ms-auto"
                onClick={() => {
                  setReintento(true);
                  cargarNoticias();
                }}
              >
                <Icon name="arrow-clockwise" /> Reintentar
              </button>
            </div>
          ) : noticias.length > 0 ? (
            <CarruselNoticias noticias={noticias} segundos={segundos} />
          ) : (
            <div className="inicio-destacados__vacio">
              <p className="mb-0">No hay noticias publicadas por ahora.</p>
              {gestionaNoticias && (
                <Link
                  to="/admin/institucional/noticias"
                  className="btn btn-primary btn-sm"
                >
                  <Icon name="plus-lg" /> Publicar una noticia
                </Link>
              )}
            </div>
          )}
        </section>
        <section
          className="inicio-destacados__columna inicio-destacados__columna--calendario"
          aria-labelledby="inicio-calendario"
        >
          <div className="inicio-destacados__cabecera">
            <h3 id="inicio-calendario" className="inicio-titulo">
              Calendario
            </h3>
            {gestionaCalendario && (
              <Link
                to="/admin/institucional/calendario"
                className="btn btn-outline-primary btn-sm"
              >
                <Icon name="calendar-event" /> Gestionar calendario
              </Link>
            )}
          </div>
          <CalendarioInicio />
        </section>
      </div>

      <section aria-labelledby="inicio-accesos">
        <h3 id="inicio-accesos" className="inicio-titulo">
          Para todos
        </h3>
        <div className="inicio-grilla">
          {ACCESOS.map((a) => (
            <Link key={a.to} to={a.to} className="inicio-tarjeta">
              <span className="inicio-tarjeta__icono" aria-hidden="true">
                <Icon name={a.icono} />
              </span>
              <span>
                <strong>{a.nombre}</strong>
                <small>{a.texto}</small>
              </span>
            </Link>
          ))}
          {veOrganigrama && (
            <Link
              to="/admin/institucional/organigrama"
              className="inicio-tarjeta"
            >
              <span className="inicio-tarjeta__icono" aria-hidden="true">
                <Icon name="diagram-3" />
              </span>
              <span>
                <strong>Organigrama</strong>
                <small>Unidades, cargos y quién los ocupa</small>
              </span>
            </Link>
          )}
        </div>
      </section>

      {modulos.length > 0 && (
        <section aria-labelledby="inicio-modulos">
          <h3 id="inicio-modulos" className="inicio-titulo">
            Sus módulos
          </h3>
          <div className="inicio-grilla">
            {modulos.map((m) => (
              <button
                key={m.id}
                type="button"
                className="inicio-tarjeta"
                onClick={() => abrir(m)}
              >
                <span className="inicio-tarjeta__icono" aria-hidden="true">
                  <Icon name={m.icono} />
                </span>
                <span>
                  <strong>{m.nombre}</strong>
                  <small>{m.descripcion}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
