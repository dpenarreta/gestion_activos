import { useEffect, useState } from "react";
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

  // El carrusel: las noticias vigentes hoy y cada cuántos segundos cambia.
  useEffect(() => {
    let vigente = true;
    Promise.all([
      Promise.resolve(institucionalService.noticias?.()),
      Promise.resolve(institucionalService.carrusel?.()),
    ])
      .then(([lista, ajustes]) => {
        if (!vigente) return;
        setNoticias(Array.isArray(lista) ? lista : []);
        if (ajustes?.segundos) setSegundos(ajustes.segundos);
      })
      .catch(() => null);
    return () => {
      vigente = false;
    };
  }, []);

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
        <div className="inicio-destacados__columna">
          <div className="inicio-destacados__cabecera">
            <h3 className="inicio-titulo">Noticias y eventos</h3>
            {gestionaNoticias && (
              <Link
                to="/admin/institucional/noticias"
                className="btn btn-outline-primary btn-sm"
              >
                <Icon name="images" /> Gestionar noticias
              </Link>
            )}
          </div>
          {noticias.length > 0 ? (
            <CarruselNoticias noticias={noticias} segundos={segundos} />
          ) : (
            <div className="inicio-destacados__vacio">
              No hay noticias publicadas por ahora.
            </div>
          )}
        </div>
        <div className="inicio-destacados__columna inicio-destacados__columna--calendario">
          <div className="inicio-destacados__cabecera">
            <h3 className="inicio-titulo">Calendario</h3>
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
        </div>
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
