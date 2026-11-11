import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { institucionalService } from "../../api/institucionalService";
import { FilaDeEstado } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { useAuth } from "../../hooks/useAuth";
import { useUltimaPeticion } from "../../hooks/useUltimaPeticion";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
import { nombreDeCargo } from "./organigrama";
import "./Institucional.css";
import { usePedirMotivo } from "../../components/common/PedirMotivo/PedirMotivo";

/** El permiso para cambiar el área de una persona (US-005, 11/11/2026). */
const PERMISO_CAMBIAR_AREA = "organizacion.cambiar_area";

/**
 * El área de una persona con el control para cambiarla. El área se elige en
 * el select y se guarda con su botón, que aparece solo si hay un cambio: así
 * recorrer el select con las flechas no abre la ventana en cada opción. Como
 * el cambio de cargo, pide el motivo (queda en la auditoría). El error del
 * servidor queda junto al campo y el foco vuelve al select al terminar.
 */
function CambiarArea({
  persona,
  areas,
  pedirMotivo,
  onEmpieza,
  onCambiada,
  onFalla,
}) {
  const [guardada, setGuardada] = useState(persona.area);
  const actual = guardada ? String(guardada.id) : "";
  const [elegida, setElegida] = useState(actual);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const select = useRef(null);
  // El select está deshabilitado mientras guarda: el foco se le devuelve
  // cuando vuelve a estar habilitado.
  const devolverFoco = useRef(false);
  useEffect(() => {
    if (!guardando && devolverFoco.current) {
      devolverFoco.current = false;
      select.current?.focus();
    }
  }, [guardando]);
  const nombre = persona.nombre || persona.correo;
  const idError = `asignacion-area-error-${persona.id}`;

  // Si la lista se recarga con otra área (cambiada en otra parte), el control
  // parte de ella; la recarga tras guardar otra fila no pisa lo elegido en
  // esta, porque su área no cambió.
  const areaDeLaLista = persona.area?.id ?? null;
  const [areaVista, setAreaVista] = useState(areaDeLaLista);
  if (areaVista !== areaDeLaLista) {
    setAreaVista(areaDeLaLista);
    setGuardada(persona.area);
    setElegida(persona.area ? String(persona.area.id) : "");
  }

  // `areas` es null mientras llega la lista: entonces solo se muestra la que
  // tiene, sin marcarla. Ya con la lista, si no está en ella es que está
  // inactiva: se muestra igual para no confundir «sin área» con «área
  // desactivada».
  const cargando = areas === null;
  const lista = areas ?? [];
  const enLista = lista.some((a) => String(a.id) === actual);
  const opciones =
    guardada && !enLista
      ? [{ ...guardada, inactiva: !cargando }, ...lista]
      : lista;
  const hayCambio = !cargando && elegida !== "" && elegida !== actual;

  async function guardar() {
    // Con `aria-disabled` el botón sigue enfocable mientras guarda: el
    // segundo clic se ignora aquí.
    if (guardando) return;
    const nueva = lista.find((a) => String(a.id) === elegida);
    if (!nueva) return;
    const motivo = await pedirMotivo(
      guardada
        ? `${nombre} pasa del área «${guardada.nombre}» a «${nueva.nombre}». Se ajustan los roles de su cargo.`
        : `${nombre} pasa al área «${nueva.nombre}». Se ajustan los roles de su cargo.`,
    );
    if (!motivo) {
      // Sin motivo no se cambia: el select vuelve a la guardada.
      setElegida(actual);
      return;
    }
    setGuardando(true);
    setError(null);
    onEmpieza();
    try {
      const respuesta = await institucionalService.cambiarArea(
        persona.id,
        nueva.id,
        motivo,
      );
      const area = respuesta.area ?? nueva;
      setGuardada(area);
      setElegida(String(area.id));
      setAreaVista(area.id);
      await onCambiada(persona, area);
    } catch (err) {
      const porCampo = erroresPorCampo(err);
      setError(
        porCampo.area ??
          porCampo.motivo ??
          porCampo.usuario ??
          mensajeDeError(err, "No se pudo cambiar el área."),
      );
      onFalla();
    } finally {
      devolverFoco.current = true;
      setGuardando(false);
    }
  }

  return (
    <div className="asignacion-area">
      <div className="asignacion-area__fila">
        <select
          ref={select}
          className={`form-select form-select-sm${error ? " is-invalid" : ""}`}
          aria-label={`Área de ${nombre}`}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? idError : undefined}
          value={elegida}
          disabled={guardando}
          onChange={(e) => {
            setElegida(e.target.value);
            setError(null);
          }}
        >
          {/* Quitar el área no se permite: con una ya puesta, «Sin área» no
              se ofrece (QA-UX N4). */}
          {guardada ? (
            <option value="" disabled hidden>
              Elija un área
            </option>
          ) : (
            <option value="">Sin área</option>
          )}
          {opciones.map((a) => (
            <option key={a.id} value={a.id} disabled={a.inactiva}>
              {a.nombre}
              {a.inactiva ? " (inactiva)" : ""}
            </option>
          ))}
        </select>
        {(hayCambio || guardando) && (
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            aria-disabled={guardando ? "true" : undefined}
            onClick={guardar}
          >
            {guardando ? "Guardando…" : "Guardar"}
            <span className="visually-hidden"> el área de {nombre}</span>
          </button>
        )}
      </div>
      {error && (
        <div id={idError} className="invalid-feedback d-block" role="alert">
          <Icon name="exclamation-circle" /> {error}
        </div>
      )}
    </div>
  );
}

/**
 * Estructura → pestaña «Asignación de cargos»: quién ocupa cada cargo y en
 * qué área está. Cada persona elige su cargo y su área una sola vez en «Mi
 * perfil»; desde aquí los ajusta quien administra el organigrama (el área,
 * con `organizacion.cambiar_area`).
 *
 * Recibe el organigrama ya cargado por la página y avisa (`onAsignado`) para
 * que se recargue: así las plazas y vacantes de las otras pestañas quedan al
 * día.
 */
export function AsignacionCargos({ datos, onAsignado }) {
  // `?buscar=` llega desde la ficha de un usuario («Cambiar en Asignación de
  // cargos»): la lista se abre ya en esa persona (09/11/2026).
  const [parametros] = useSearchParams();
  const [buscar, setBuscar] = useState(() => parametros.get("buscar") ?? "");
  const [personas, setPersonas] = useState(null);
  const [error, setError] = useState(null);
  // El fallo al cargar la lista va en la tabla, con «Reintentar» (auditoría
  // UX/UI, fase 2, 28/10/2026).
  const [errorCarga, setErrorCarga] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [pedirMotivo, dialogoMotivo] = usePedirMotivo();
  // El área se ve siempre; cambiarla pide su propio permiso (US-005).
  const { user } = useAuth();
  const puedeCambiarArea = Boolean(
    user?.permissions?.includes(PERMISO_CAMBIAR_AREA),
  );
  // Las áreas que se pueden asignar: las mismas activas de «Mi perfil».
  // `null` mientras llegan. Su error va aparte del de cada acción: no se
  // borra al asignar un cargo o cambiar otra área, solo al reintentar.
  const [areas, setAreas] = useState(null);
  const [errorAreas, setErrorAreas] = useState(null);
  const ultimaDeAreas = useUltimaPeticion();
  const cargarAreas = useCallback(() => {
    const vigente = ultimaDeAreas();
    setErrorAreas(null);
    institucionalService
      .areasParaAsignar()
      .then((lista) => vigente() && setAreas(lista))
      .catch(
        (err) =>
          vigente() &&
          setErrorAreas(
            mensajeDeError(err, "No se pudieron cargar las áreas."),
          ),
      );
  }, [ultimaDeAreas]);
  useEffect(() => {
    if (puedeCambiarArea) cargarAreas();
  }, [puedeCambiarArea, cargarAreas]);

  // Solo cuenta la respuesta de lo último escrito: una lenta no pisa a la
  // más nueva (búsqueda en vivo, 06/11/2026).
  const nuevaPeticion = useUltimaPeticion();
  const cargarPersonas = useCallback(
    (texto) => {
      const vigente = nuevaPeticion();
      setErrorCarga(null);
      return institucionalService
        .asignaciones(texto)
        .then((lista) => vigente() && setPersonas(lista))
        .catch(
          (err) =>
            vigente() &&
            setErrorCarga(
              mensajeDeError(err, "No se pudieron cargar las personas."),
            ),
        );
    },
    [nuevaPeticion],
  );

  // Al cambiar la búsqueda se conserva la lista anterior hasta que llega la
  // nueva (antes volvía a «Cargando…» en cada palabra).
  const buscarPersonas = useCallback(
    () => cargarPersonas(buscar),
    [buscar, cargarPersonas],
  );

  useEffect(() => {
    const espera = setTimeout(buscarPersonas, 250);
    return () => clearTimeout(espera);
  }, [buscarPersonas]);

  async function asignar(persona, cargo) {
    setError(null);
    setAviso(null);
    const nombre = (datos?.cargos ?? []).find(
      (c) => String(c.id) === String(cargo),
    )?.nombre;
    const motivo = await pedirMotivo(
      cargo
        ? `${persona.nombre} pasa al cargo «${nombre ?? cargo}».`
        : `${persona.nombre} queda sin cargo.`,
    );
    if (!motivo) {
      // Sin motivo no se cambia: la lista vuelve a mostrar el cargo de antes.
      await cargarPersonas(buscar);
      return;
    }
    try {
      await institucionalService.asignar(persona.id, cargo, motivo);
      setAviso(
        cargo
          ? `${persona.nombre} quedó en su nuevo cargo.`
          : `${persona.nombre} quedó sin cargo.`,
      );
      await Promise.all([cargarPersonas(buscar), onAsignado?.()]);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo asignar el cargo."));
    }
  }

  // Al empezar a guardar un área, o si falla, el aviso anterior se quita: si
  // no, el éxito de otra fila parecería el de esta.
  function limpiarAvisos() {
    setError(null);
    setAviso(null);
  }

  async function areaCambiada(persona, area) {
    setAviso(
      `${persona.nombre || persona.correo} quedó en el área «${area.nombre}».`,
    );
    await cargarPersonas(buscar);
  }

  const cargos = (datos?.cargos ?? []).filter((c) => c.activo);

  return (
    <div className="mz-stack asignacion-cargos">
      {dialogoMotivo}
      <p className="mz-faint mb-0">
        Quién ocupa cada cargo y en qué área está. Cada persona elige su cargo y
        su área una sola vez en «Mi perfil»; después solo se cambian desde aquí.
        Si no son los correctos, la persona los pide a Gestión Humana por la
        Mesa de ayuda.
      </p>

      <input
        type="search"
        className="form-control form-control-sm org-barra__buscar ms-0"
        placeholder="Buscar por nombre o correo"
        aria-label="Buscar por nombre o correo"
        value={buscar}
        onChange={(e) => {
          setBuscar(e.target.value);
          // El aviso era de la lista anterior.
          setAviso(null);
        }}
      />

      {errorAreas && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          <span className="flex-grow-1">{errorAreas}</span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm mz-tactil"
            onClick={cargarAreas}
          >
            Reintentar
          </button>
        </div>
      )}

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {/* Montado siempre para que el lector anuncie cada aviso nuevo. */}
      <div role="status">
        {aviso && (
          <div className="mz-alert mz-alert--ok">
            <Icon name="check-circle" />
            {aviso}
          </div>
        )}
      </div>
      {datos && cargos.length === 0 && (
        <p className="mz-faint">
          Todavía no hay cargos: créelos en la pestaña «Cargos» para poder
          asignarlos.
        </p>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Persona</th>
              <th>Correo</th>
              <th>Cargo</th>
              <th>Área</th>
            </tr>
          </thead>
          <tbody>
            {(personas ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td className="mz-small">{p.correo}</td>
                <td>
                  <select
                    className="form-select form-select-sm"
                    aria-label={`Cargo de ${p.nombre}`}
                    value={p.cargo?.id ?? ""}
                    disabled={cargos.length === 0}
                    onChange={(e) => asignar(p, e.target.value)}
                  >
                    <option value="">Sin cargo</option>
                    {cargos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {nombreDeCargo(c, datos.unidades, datos.cargos)}
                        {c.vacantes === 0 && c.id !== p.cargo?.id
                          ? " (sin vacantes)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {puedeCambiarArea ? (
                    <CambiarArea
                      persona={p}
                      areas={areas}
                      pedirMotivo={pedirMotivo}
                      onEmpieza={limpiarAvisos}
                      onCambiada={areaCambiada}
                      onFalla={limpiarAvisos}
                    />
                  ) : (
                    (p.area?.nombre ?? (
                      <span className="mz-faint">Sin área</span>
                    ))
                  )}
                </td>
              </tr>
            ))}
            <FilaDeEstado
              columnas={4}
              cargando={personas === null}
              error={errorCarga}
              onReintentar={buscarPersonas}
              vacio={personas?.length === 0}
              textoVacio="Todavía no hay personas."
              hayFiltros={buscar.trim() !== ""}
              onLimpiarFiltros={() => setBuscar("")}
            />
          </tbody>
        </table>
      </div>
    </div>
  );
}
