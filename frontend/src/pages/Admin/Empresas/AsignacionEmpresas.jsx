import { useContext, useEffect, useRef, useState } from "react";

import { adminUsersService } from "../../../api/adminUsersService";
import { empresasService } from "../../../api/empresasService";
import { catalogoMatrizService } from "../../../api/matrizService";
import { rolesService } from "../../../api/rolesService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { AuthContext } from "../../../context/AuthContext";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import {
  AnadirRol,
  FichasDeRoles,
  RolEnEmpresa,
  fichaDeRol,
} from "./ControlesDeRol";
import { rolesElegibles } from "./rolesElegibles";
import "./Empresas.css";

/**
 * A qué empresas entra una cuenta y qué puede hacer en cada una.
 *
 * Van juntas porque son una sola decisión. Dar acceso a una empresa sin decir
 * a qué, o decir a qué sin dar el acceso, son estados a medias que alguien
 * tendría que acordarse de completar; y el rol es justamente lo que convierte
 * «ve LaarSeguridad» en «puede dar de baja equipos de LaarSeguridad».
 *
 * Va en la ficha del usuario y no en la de la empresa porque la pregunta que se
 * hace de verdad es «qué ve esta persona», no «quiénes ven esta empresa»: tanto
 * el alta de un empleado como la revisión de un acceso se miran cuenta a cuenta.
 *
 * Los roles globales van aparte y exigen otro permiso (`usuarios.editar`): valen
 * en todas las empresas, incluidas las que se creen mañana, así que conceder uno
 * no es lo mismo que dar acceso a una empresa concreta.
 *
 * Cada empresa se maneja con el mismo desplegable «Rol» del alta, y los
 * globales van plegados en «Opciones avanzadas»: puestos a la vista, con una
 * rejilla de decenas de casillas cada uno, se leían como un segundo rol «para
 * permisos» distinto del elegido al crear la cuenta (queja de usuario,
 * 06/11/2026). Se abren solos solo si la cuenta ya tiene alguno, para que nadie
 * deje de ver lo que la persona puede hacer.
 *
 * Es una lista de bloques y no una tabla: la identidad base oculta
 * `.mz-table-wrap` por debajo de 880 px, y en el móvil la asignación entera
 * desaparecía.
 */
export function AsignacionEmpresas({ usuarioId, onCambiosSinGuardar }) {
  const puedeVer = usePermission("empresas.ver");
  const puedeAsignar = usePermission("empresas.asignar");
  const puedeRolesGlobales = usePermission("usuarios.editar");
  // Quien mira la ficha, no la cuenta mirada. Sin `useAuth`, que exige el
  // proveedor: la ficha también se pinta suelta en las pruebas.
  const actorEsSuperusuario = Boolean(
    useContext(AuthContext)?.user?.is_superuser,
  );

  const [empresas, setEmpresas] = useState([]);
  const [roles, setRoles] = useState([]);
  const [sinCatalogoDeRoles, setSinCatalogoDeRoles] = useState(false);
  const [asignadas, setAsignadas] = useState({});
  // Las áreas de la Matriz por empresa (§8.7). `null` si no se pudo leer el
  // catálogo: entonces no se envían y el servidor conserva las que había.
  const [areas, setAreas] = useState(null);
  const [areasAsignadas, setAreasAsignadas] = useState({});
  const [predeterminada, setPredeterminada] = useState(null);
  const [rolesGlobales, setRolesGlobales] = useState([]);
  // Los nombres de los roles que ya tiene, por si el catálogo no los trae.
  const [nombresConocidos, setNombresConocidos] = useState({});
  const [avanzadoAbierto, setAvanzadoAbierto] = useState(false);
  // Con una sola empresa el bloque avanzado solo se dibuja si la cuenta tenía
  // globales al cargar, o si un superusuario lo pide (auditoría UX/UI,
  // 06/11/2026): si no, volvía a haber dos sitios donde mirar el rol.
  const [globalesAlCargar, setGlobalesAlCargar] = useState(0);
  const [mostrarAvanzado, setMostrarAvanzado] = useState(false);
  // Empresas cuyo rol principal se dejó vacío a propósito con adicionales.
  const [sinPrincipal, setSinPrincipal] = useState({});
  // Lo que cambió, para el lector de pantalla: los cambios no se guardan
  // hasta «Guardar accesos» y nada más lo diría.
  const [anuncio, setAnuncio] = useState("");
  const anadirGlobalRef = useRef(null);
  const resumenAvanzado = useRef(null);
  const grupoGlobal = useRef(null);
  const [esSuperusuario, setEsSuperusuario] = useState(false);
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  // Hay algo marcado o desmarcado que todavía no se guardó: la ficha lo usa
  // para avisar al salir (auditoría UX/UI, fase 2, 28/10/2026).
  const [sinGuardar, setSinGuardar] = useState(false);
  // Guardar solo después de cargar bien lo que la persona tiene: antes, con
  // la carga en curso o fallida, «Guardar accesos» enviaba listas vacías y le
  // quitaba todas sus empresas y roles (revisión final UX/UI, 28/10/2026).
  const [cargado, setCargado] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    onCambiosSinGuardar?.(sinGuardar);
  }, [sinGuardar, onCambiosSinGuardar]);

  function cambiar() {
    setMensaje(null);
    setSinGuardar(true);
  }

  useEffect(() => {
    if (!puedeVer || !usuarioId) return;
    setCargado(false);
    setError(null);
    Promise.all([
      empresasService.list({ page_size: 100 }),
      adminUsersService.get(usuarioId),
      // Sin `roles.ver` el catálogo no se puede leer, pero las empresas sí se
      // pueden seguir asignando: se degrada la columna, no la pantalla.
      rolesService.list().catch(() => null),
      catalogoMatrizService("areas")
        .list()
        .catch(() => null),
    ])
      .then(([listado, usuario, catalogo, catalogoAreas]) => {
        const todas = listado.results ?? [];
        setEmpresas(todas);
        setAreas(
          catalogoAreas?.filter((area) => area.activo !== false) ?? null,
        );
        setRoles(catalogo ?? []);
        setSinCatalogoDeRoles(catalogo === null);
        const membresias = usuario.empresas ?? [];
        // El servidor no guarda un orden entre los roles de una empresa: se
        // ordenan por nombre para que el principal sea siempre el mismo al
        // volver a abrir la ficha.
        const porNombre = (a, b) =>
          a.name.localeCompare(b.name, "es", { sensitivity: "base" });
        const asignadasAhora = Object.fromEntries(
          membresias.map((empresa) => [
            empresa.id,
            [...(empresa.roles ?? [])].sort(porNombre).map((rol) => rol.id),
          ]),
        );
        setNombresConocidos(
          Object.fromEntries(
            [
              ...membresias.flatMap((empresa) => empresa.roles ?? []),
              ...(usuario.roles ?? []),
            ].map((rol) => [rol.id, rol.name]),
          ),
        );
        // Con una sola empresa (23/10/2026) toda cuenta trabaja en ella: no
        // se marca, solo se eligen sus roles.
        if (todas.length === 1 && !(todas[0].id in asignadasAhora))
          asignadasAhora[todas[0].id] = [];
        setAsignadas(asignadasAhora);
        setAreasAsignadas(
          Object.fromEntries(
            membresias.map((empresa) => [
              empresa.id,
              (empresa.areas ?? []).map((area) => area.id),
            ]),
          ),
        );
        setPredeterminada(
          todas.length === 1
            ? todas[0].id
            : (membresias.find((empresa) => empresa.es_predeterminada)?.id ??
                null),
        );
        const globales = (usuario.roles ?? []).map((rol) => rol.id);
        setRolesGlobales(globales);
        setGlobalesAlCargar(globales.length);
        // Abierto si ya tiene globales, salvo con una sola empresa y sin rol
        // propio en ella: entonces el rol global ya se nombra bajo el
        // desplegable («Ya tiene…»), y abrirlo era volver a mostrarlo en dos
        // sitios (auditoría UX/UI, 06/11/2026). Los de cargo no cuentan como
        // rol propio: no los elige nadie.
        const deCargo = new Set(
          (catalogo ?? []).filter((rol) => rol.cargo).map((rol) => rol.id),
        );
        const sinRolPropio =
          todas.length === 1 &&
          (asignadasAhora[todas[0].id] ?? []).every((id) => deCargo.has(id));
        setAvanzadoAbierto(globales.length > 0 && !sinRolPropio);
        setMostrarAvanzado(false);
        setSinPrincipal({});
        setAnuncio("");
        setEsSuperusuario(Boolean(usuario.is_superuser));
        setCargado(true);
      })
      .catch(() =>
        setError(
          "No se pudieron cargar los accesos de esta persona. No se puede guardar hasta que carguen.",
        ),
      );
  }, [usuarioId, puedeVer, intento]);

  function alternarEmpresa(empresaId) {
    cambiar();
    setAsignadas((actuales) => {
      const siguiente = { ...actuales };
      if (empresaId in siguiente) {
        delete siguiente[empresaId];
        // Quitar la predeterminada dejaría al usuario entrando cada día en una
        // empresa que ya no puede ver.
        if (predeterminada === empresaId) {
          const quedan = Object.keys(siguiente).map(Number);
          setPredeterminada(quedan[0] ?? null);
        }
      } else {
        siguiente[empresaId] = [];
        if (predeterminada === null) setPredeterminada(empresaId);
      }
      return siguiente;
    });
  }

  function cambiarRoles(empresaId, roles, vacioElPrincipal = false) {
    cambiar();
    setAsignadas((actuales) => ({ ...actuales, [empresaId]: roles }));
    setSinPrincipal((actuales) => ({
      ...actuales,
      [empresaId]: vacioElPrincipal,
    }));
  }

  // Con una sola empresa: el rol global pasa a ser el de la empresa.
  function pasarGlobalAEmpresa(empresaId, rolId) {
    cambiar();
    setRolesGlobales((actuales) => actuales.filter((id) => id !== rolId));
    setAsignadas((actuales) => ({
      ...actuales,
      [empresaId]: [
        rolId,
        ...(actuales[empresaId] ?? []).filter((id) => id !== rolId),
      ],
    }));
    setSinPrincipal((actuales) => ({ ...actuales, [empresaId]: false }));
  }

  function alternarArea(empresaId, areaId) {
    cambiar();
    setAreasAsignadas((actuales) => {
      const propias = actuales[empresaId] ?? [];
      return {
        ...actuales,
        [empresaId]: propias.includes(areaId)
          ? propias.filter((id) => id !== areaId)
          : [...propias, areaId],
      };
    });
  }

  function anadirRolGlobal(rolId) {
    cambiar();
    setRolesGlobales((actuales) => [...actuales, rolId]);
  }

  function quitarRolGlobal(rolId) {
    cambiar();
    setRolesGlobales((actuales) => actuales.filter((id) => id !== rolId));
  }

  function abrirAvanzado() {
    setMostrarAvanzado(true);
    setAvanzadoAbierto(true);
    requestAnimationFrame(() => resumenAvanzado.current?.focus());
  }

  async function guardar() {
    if (!cargado) return;
    setIsSaving(true);
    setError(null);
    setMensaje(null);
    try {
      if (puedeAsignar) {
        await adminUsersService.assignEmpresas(
          usuarioId,
          Object.entries(asignadas).map(([empresaId, rolesDeLaEmpresa]) => ({
            empresa_id: Number(empresaId),
            roles: rolesDeLaEmpresa,
            es_predeterminada: Number(empresaId) === predeterminada,
            ...(areas !== null && {
              areas: areasAsignadas[empresaId] ?? [],
            }),
          })),
        );
      }
      if (puedeRolesGlobales) {
        await adminUsersService.assignRoles(usuarioId, rolesGlobales);
      }
      setMensaje(
        empresas.length === 1
          ? "Roles actualizados."
          : "Empresas y roles actualizados.",
      );
      setSinGuardar(false);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudieron guardar los accesos."));
    } finally {
      setIsSaving(false);
    }
  }

  if (!puedeVer) return null;
  const unica = empresas.length === 1;
  const elegibles = rolesElegibles(roles);
  const porId = Object.fromEntries(roles.map((rol) => [rol.id, rol]));
  const nombreDe = (id) =>
    porId[id]?.name ?? nombresConocidos[id] ?? `Rol ${id}`;
  const esDeCargo = (id) => Boolean(porId[id]?.cargo);
  const ayudaId = "empresas-asignacion-ayuda";
  const verAvanzado =
    !unica ||
    globalesAlCargar > 0 ||
    rolesGlobales.length > 0 ||
    mostrarAvanzado;
  const globalesConNombre = rolesGlobales.map((id) => ({
    id,
    name: nombreDe(id),
  }));

  return (
    <section className="mz-card empresas-asignacion">
      <div className="mz-card-head">
        <h3>{unica ? "Roles" : "Empresas y roles"}</h3>
      </div>
      <div className="mz-card-body">
        {/* La ayuda va una sola vez y no bajo cada desplegable: con varias
            empresas se repetiría tantas veces como filas. Cada desplegable
            la enlaza. Con una sola empresa, un único párrafo y sin hablar de
            «esta empresa», que ahí no se elige. */}
        {unica ? (
          <p id={ayudaId} className="mz-faint">
            Lo que puede hacer en el sistema lo dice su rol; los permisos de
            cada rol se ven en Configuración › Usuarios y roles › Roles. El de
            su cargo lo pone el organigrama.
          </p>
        ) : (
          <>
            <p className="mz-faint">
              Solo verá la información de las empresas marcadas, y en cada una
              podrá hacer lo que diga el rol que tenga ahí. La predeterminada es
              la que se abre al entrar.
            </p>
            <p id={ayudaId} className="mz-small mz-faint">
              El rol define lo que puede hacer en esta empresa; los permisos de
              cada rol se ven en Configuración › Usuarios y roles › Roles.
            </p>
          </>
        )}
        <p className="visually-hidden" role="status">
          {anuncio}
        </p>
        {esSuperusuario && (
          <div className="mz-alert mz-alert--info" role="note">
            <Icon name="shield-lock" />
            <span>
              <strong>Superusuario (cuenta).</strong> Es una marca de la cuenta,
              no un rol: tiene todos los permisos, también los que se creen más
              adelante, sin necesitar roles. Los roles que se le asignen aquí no
              le quitan nada.
            </span>
          </div>
        )}

        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        {mensaje && (
          <div className="mz-alert mz-alert--ok" role="status">
            <Icon name="check2-circle" />
            {mensaje}
          </div>
        )}

        {sinCatalogoDeRoles && (
          <div className="mz-alert mz-alert--warn" role="status">
            <Icon name="exclamation-triangle" />
            <div>
              No se pudo leer el catálogo de roles (hace falta el permiso
              «roles.ver»). Puede asignar empresas, pero no los roles de cada
              una.
            </div>
          </div>
        )}

        {/* Mientras carga, el aviso y no una lista vacía que luego salta. */}
        {!cargado && !error && <EstadoDeCarga cargando />}

        {cargado && (
          <ul className="empresas-asignacion__lista">
            {empresas.map((empresa) => {
              const estaAsignada = empresa.id in asignadas;
              // Sin rol ve la empresa en el selector pero no puede abrir nada
              // dentro: se dice aquí y no en un error posterior, cuando ya se
              // guardó. El superusuario se salta los permisos: avisarle de que
              // no verá nada sería falso.
              const sinRol =
                estaAsignada &&
                !esSuperusuario &&
                (asignadas[empresa.id] ?? []).length === 0 &&
                rolesGlobales.length === 0;
              const avisoId = sinRol ? `sin-rol-${empresa.id}` : null;
              return (
                <li key={empresa.id} className="empresas-asignacion__empresa">
                  {!unica && (
                    <div className="empresas-asignacion__cabecera">
                      <span className="mz-strong">
                        {empresa.nombre}
                        {!empresa.activa && (
                          <span className="mz-pill mz-pill--neutral ms-2">
                            Inactiva
                          </span>
                        )}
                      </span>
                      {/* Etiquetas visibles y no solo `aria-label`: en una
                        lista de bloques la columna ya no dice qué es cada
                        casilla. El nombre de la empresa va oculto para que
                        el lector sepa de cuál es. */}
                      <div className="empresas-asignacion__marcas">
                        <div className="form-check">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            id={`empresa-${empresa.id}-asignada`}
                            checked={estaAsignada}
                            disabled={!puedeAsignar}
                            onChange={() => alternarEmpresa(empresa.id)}
                          />
                          <label
                            className="form-check-label"
                            htmlFor={`empresa-${empresa.id}-asignada`}
                          >
                            Asignar
                            <span className="visually-hidden">
                              {" "}
                              {empresa.nombre}
                            </span>
                          </label>
                        </div>
                        <div className="form-check">
                          <input
                            type="radio"
                            name="empresa-predeterminada"
                            className="form-check-input"
                            id={`empresa-${empresa.id}-predeterminada`}
                            checked={predeterminada === empresa.id}
                            disabled={!puedeAsignar || !estaAsignada}
                            onChange={() => {
                              setPredeterminada(empresa.id);
                              cambiar();
                            }}
                          />
                          <label
                            className="form-check-label"
                            htmlFor={`empresa-${empresa.id}-predeterminada`}
                          >
                            Predeterminada
                            <span className="visually-hidden">
                              {" "}
                              {empresa.nombre}
                            </span>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  {estaAsignada ? (
                    <RolEnEmpresa
                      empresa={empresa}
                      unica={unica}
                      asignados={asignadas[empresa.id] ?? []}
                      sinPrincipal={Boolean(sinPrincipal[empresa.id])}
                      opciones={elegibles}
                      nombreDe={nombreDe}
                      esDeCargo={esDeCargo}
                      deshabilitado={!puedeAsignar || sinCatalogoDeRoles}
                      ayudaId={ayudaId}
                      avisoId={avisoId}
                      globales={unica ? globalesConNombre : []}
                      onPasarGlobal={
                        puedeAsignar && puedeRolesGlobales
                          ? (rolId) => {
                              pasarGlobalAEmpresa(empresa.id, rolId);
                              setAnuncio(
                                `Rol ${nombreDe(rolId)} pasado a la empresa; sin guardar.`,
                              );
                            }
                          : null
                      }
                      onCambiar={(lista, vacio) =>
                        cambiarRoles(empresa.id, lista, vacio)
                      }
                      anunciar={setAnuncio}
                    />
                  ) : (
                    <p className="mz-small mz-faint mb-0">
                      Sin acceso a esta empresa. Márquela en «Asignar» para
                      elegir su rol.
                    </p>
                  )}

                  {estaAsignada && areas !== null && areas.length > 0 && (
                    <details className="empresas-asignacion__areas">
                      <summary>
                        Temas de la Matriz (
                        {(areasAsignadas[empresa.id] ?? []).length || "todas"})
                      </summary>
                      <p className="mz-small mz-faint mb-1">
                        Quien no ve toda la empresa solo crea obligaciones de
                        estos temas. Sin ninguno marcado, de todos.
                      </p>
                      <fieldset className="empresas-asignacion__casillas">
                        <legend className="visually-hidden">
                          Temas de la Matriz en {empresa.nombre}
                        </legend>
                        {areas.map((area) => (
                          <div className="form-check" key={area.id}>
                            <input
                              type="checkbox"
                              className="form-check-input"
                              id={`area-${empresa.id}-${area.id}`}
                              checked={(
                                areasAsignadas[empresa.id] ?? []
                              ).includes(area.id)}
                              disabled={!puedeAsignar}
                              onChange={() => alternarArea(empresa.id, area.id)}
                            />
                            <label
                              className="form-check-label"
                              htmlFor={`area-${empresa.id}-${area.id}`}
                            >
                              {area.nombre}
                            </label>
                          </div>
                        ))}
                      </fieldset>
                    </details>
                  )}

                  {sinRol && (
                    <div id={avisoId} className="mz-small mz-warn mt-1">
                      <Icon name="exclamation-triangle" /> Sin rol aquí: entrará
                      a la empresa pero no verá nada dentro.
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Plegado: casi ninguna cuenta los necesita, y a la vista parecían
            un segundo rol «para permisos». Abierto solo si ya tiene alguno,
            para que nadie deje de ver lo que la persona puede hacer. */}
        {cargado && !verAvanzado && actorEsSuperusuario && (
          <button
            type="button"
            className="btn btn-link btn-sm empresas-asignacion__anadir"
            onClick={abrirAvanzado}
          >
            Opciones avanzadas · roles en todas las empresas
          </button>
        )}
        {cargado && verAvanzado && (
          <details
            className="empresas-asignacion__avanzado"
            open={avanzadoAbierto}
            onToggle={(event) => setAvanzadoAbierto(event.currentTarget.open)}
          >
            <summary ref={resumenAvanzado}>
              Opciones avanzadas · roles en todas las empresas
              {rolesGlobales.length > 0 && ` (${rolesGlobales.length})`}
            </summary>
            <p className="mz-small mz-faint">
              Valen en cualquier empresa, incluidas las que se creen después.
              Son para el administrador del grupo, que tiene que poder entrar a
              todas; para el resto de cuentas basta con el rol de cada empresa.
            </p>
            {/* Un grupo con nombre: el lector decía cada rol suelto, sin saber
              que eran los globales (revisión final UX/UI, 28/10/2026). */}
            <div
              ref={grupoGlobal}
              role="group"
              aria-label="Roles en todas las empresas"
            >
              {rolesGlobales.length === 0 && (
                <p className="mz-small mb-1">No tiene ninguno.</p>
              )}
              <FichasDeRoles
                id="roles-globales-asignados"
                titulo="Asignados en todas las empresas"
                roles={globalesConNombre}
                contexto=" en todas las empresas"
                deshabilitado={!puedeRolesGlobales}
                onQuitar={(rolId) => {
                  quitarRolGlobal(rolId);
                  setAnuncio(
                    `Rol ${nombreDe(rolId)} quitado de todas las empresas; sin guardar.`,
                  );
                }}
                focoAlVaciar={() =>
                  anadirGlobalRef.current ?? resumenAvanzado.current
                }
              />
              {puedeRolesGlobales && (
                <AnadirRol
                  idBase="rol-global"
                  botonRef={anadirGlobalRef}
                  textoBoton="Añadir un rol en todas las empresas"
                  etiqueta="Rol en todas las empresas"
                  opciones={elegibles.filter(
                    (rol) => !rolesGlobales.includes(rol.id),
                  )}
                  onAnadir={(rolId) => {
                    anadirRolGlobal(rolId);
                    setAnuncio(
                      `Rol ${nombreDe(rolId)} añadido en todas las empresas; sin guardar.`,
                    );
                  }}
                  focoTrasAnadir={(rolId) =>
                    fichaDeRol(grupoGlobal.current, rolId) ??
                    resumenAvanzado.current
                  }
                />
              )}
            </div>
          </details>
        )}

        {(puedeAsignar || puedeRolesGlobales) && (
          <div className="mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-primary"
              disabled={isSaving || !cargado}
              onClick={guardar}
            >
              {isSaving
                ? "Guardando…"
                : cargado
                  ? "Guardar accesos"
                  : "Cargando accesos…"}
            </button>
            {!cargado && error && (
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setIntento((n) => n + 1)}
              >
                Reintentar
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
