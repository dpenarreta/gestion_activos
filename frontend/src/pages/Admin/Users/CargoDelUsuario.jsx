import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { empresasService } from "../../../api/empresasService";
import { institucionalService } from "../../../api/institucionalService";
import { Icon } from "../../../components/common/Icon/Icon";
import { useUnsavedChanges } from "../../../context/UnsavedChangesContext";
import { usePermission } from "../../../hooks/usePermission";
import { nombreDeCargo } from "../../Institucional/organigrama";

const ASIGNACION_DE_CARGOS =
  "/admin/institucional/estructura?pestana=asignaciones";

/**
 * En la ficha del usuario, tarjeta Roles: qué cargo del organigrama ocupa y
 * qué rol le da (09/11/2026). Solo lectura: el cargo se cambia en Institucional
 * › Estructura › Asignación de cargos, donde además se pide el motivo para la
 * bitácora. Un segundo editor aquí serían dos caminos para el mismo dato.
 *
 * Lo ve quien ve el organigrama completo (`institucional.ver`, `editar`,
 * `asignar` o `perfil_cargo`, como `OrganigramaView`); el enlace para
 * cambiarlo, solo quien asigna cargos. Es el cargo en la empresa de la
 * pestaña: el organigrama es de cada empresa, y con varias se dice de cuál
 * («Sin cargo en el organigrama de LaarCourier»), porque en otra puede
 * tener uno (revisión UX/UI, 09/11/2026).
 */
export function CargoDelUsuario({ usuarioId, nombre = "" }) {
  const puedeAsignar = usePermission("institucional.asignar");
  const puedeVerTodo = usePermission("institucional.ver");
  const puedeEditar = usePermission("institucional.editar");
  const puedePerfil = usePermission("institucional.perfil_cargo");
  const puedeVer = puedeAsignar || puedeVerTodo || puedeEditar || puedePerfil;
  const { guardedNavigate } = useUnsavedChanges();
  // `undefined` mientras carga; `null` si no ocupa ninguno.
  const [cargo, setCargo] = useState(undefined);
  const [error, setError] = useState(false);
  const [vez, setVez] = useState(0);
  // El nombre de la empresa de la pestaña, solo si hay varias.
  const [empresa, setEmpresa] = useState(null);

  useEffect(() => {
    if (!puedeVer || !usuarioId) return undefined;
    let vigente = true;
    setError(false);
    setCargo(undefined);
    // Saber la empresa es un adorno: si falla, la línea sale sin ella.
    Promise.resolve()
      .then(() => empresasService.mias())
      .then(
        (mias) =>
          vigente &&
          setEmpresa(mias?.multiempresa ? mias.activa?.nombre : null),
      )
      .catch(() => {});
    Promise.resolve()
      .then(() => institucionalService.organigrama())
      .then((datos) => {
        if (!vigente) return;
        const id = Number(usuarioId);
        const suyo = (datos?.cargos ?? []).find((c) =>
          (c.ocupantes ?? []).some((o) => !o.sin_cuenta && o.id === id),
        );
        setCargo(
          suyo
            ? {
                etiqueta: nombreDeCargo(
                  suyo,
                  datos.unidades ?? [],
                  datos.cargos,
                ),
                rol: suyo.rol?.nombre ?? null,
              }
            : null,
        );
      })
      .catch(() => vigente && setError(true));
    return () => {
      vigente = false;
    };
  }, [puedeVer, usuarioId, vez]);

  if (!puedeVer) return null;

  // Con su nombre, la lista de Asignación de cargos se abre ya filtrada.
  const destino = nombre.trim()
    ? `${ASIGNACION_DE_CARGOS}&buscar=${encodeURIComponent(nombre.trim())}`
    : ASIGNACION_DE_CARGOS;
  const enlace = puedeAsignar && (
    <Link
      to={destino}
      onClick={(event) => {
        event.preventDefault();
        guardedNavigate(destino);
      }}
    >
      {cargo ? "Cambiar en Asignación de cargos" : "Asignar un cargo"}
    </Link>
  );

  return (
    <div className="mz-small mb-3" aria-busy={cargo === undefined && !error}>
      <Icon name="diagram-3" />{" "}
      {error ? (
        <>
          No se pudo consultar su cargo en el organigrama.{" "}
          <button
            type="button"
            className="btn btn-link btn-sm p-0 align-baseline"
            onClick={() => setVez((v) => v + 1)}
          >
            Reintentar
          </button>
        </>
      ) : cargo === undefined ? (
        <span className="mz-faint">
          Consultando su cargo en el organigrama…
        </span>
      ) : cargo ? (
        <>
          {empresa ? `Cargo en ${empresa}: ` : "Cargo: "}
          <strong>{cargo.etiqueta}</strong>
          {cargo.rol
            ? ` (le da el rol ${cargo.rol})`
            : " (sin rol todavía)"}. {enlace}
        </>
      ) : (
        <>
          <span className="mz-faint">
            {empresa
              ? `Sin cargo en el organigrama de ${empresa}.`
              : "Sin cargo en el organigrama."}
          </span>{" "}
          {enlace}
        </>
      )}
    </div>
  );
}
