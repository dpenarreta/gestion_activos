import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { nominaService } from "../../../api/nominaService";
import { useAuth } from "../../../hooks/useAuth";
import { Icon } from "../../common/Icon/Icon";
import "./RecordatorioRolPagos.css";

const CLAVE = "aviso_rol.pospuesto";
/** El evento con el que el aviso dice que se pospuso, para que la franja
 * aparezca enseguida y no recién al cambiar de pantalla. */
export const EVENTO_POSPUESTO = "aviso-rol-pospuesto";

function clave(usuario, aviso) {
  return `${CLAVE}.${usuario}.${aviso.anio}-${aviso.mes}`;
}

function pospuesto(usuario, aviso) {
  try {
    return sessionStorage.getItem(clave(usuario, aviso)) === "1";
  } catch {
    return false;
  }
}

/** Si en esta sesión pospuso algún aviso: si no, ni se pregunta al servidor. */
function algunoPospuesto(usuario) {
  try {
    const prefijo = `${CLAVE}.${usuario}.`;
    return Object.keys(sessionStorage).some((k) => k.startsWith(prefijo));
  } catch {
    return false;
  }
}

/** Lo llama el aviso al pulsar «Recordarme después» (o la X / Escape). */
export function marcarPospuesto(usuario, aviso) {
  try {
    sessionStorage.setItem(clave(usuario, aviso), "1");
  } catch {
    /* Sin almacenamiento la franja dura hasta cambiar de pantalla. */
  }
  window.dispatchEvent(new CustomEvent(EVENTO_POSPUESTO, { detail: aviso }));
}

/**
 * El segundo texto del aviso del rol de pagos (29/10/2026): si la persona
 * pospone el aviso con «Recordarme después», queda arriba de cada pantalla
 * una franja que le recuerda la fecha máxima para aceptar su rol antes de una
 * sanción o un llamado de atención; con el plazo vencido, que ya venció. Dura
 * la sesión y desaparece al aceptar el rol (se vuelve a preguntar al servidor
 * en cada cambio de pantalla). No se cierra: es el recordatorio que se pidió.
 * En la pantalla del rol de pagos no se muestra, porque ahí ya está.
 */
export function RecordatorioRolPagos() {
  const { user } = useAuth();
  const usuario = user?.id;
  const { pathname } = useLocation();
  const [aviso, setAviso] = useState(null);
  const [ahora, setAhora] = useState(0);

  useEffect(() => {
    const alPosponer = () => setAhora((n) => n + 1);
    window.addEventListener(EVENTO_POSPUESTO, alPosponer);
    return () => window.removeEventListener(EVENTO_POSPUESTO, alPosponer);
  }, []);

  useEffect(() => {
    if (!usuario || !algunoPospuesto(usuario)) {
      setAviso(null);
      return undefined;
    }
    let vigente = true;
    Promise.resolve(nominaService.aviso?.())
      .then((datos) => {
        if (!vigente) return;
        setAviso(
          datos?.mostrar &&
            datos.recordatorio &&
            Number(datos.anio) &&
            Number(datos.mes) &&
            pospuesto(usuario, datos)
            ? datos
            : null,
        );
      })
      .catch(() => vigente && setAviso(null));
    return () => {
      vigente = false;
    };
  }, [usuario, pathname, ahora]);

  if (!aviso || pathname.endsWith("/institucional/rol-pagos")) return null;

  return (
    <div
      className={`recordatorio-rol${aviso.vencido ? " recordatorio-rol--vencido" : ""}`}
      role="status"
    >
      <Icon
        name={aviso.vencido ? "exclamation-triangle-fill" : "alarm"}
        label={aviso.vencido ? "Plazo vencido" : "Recordatorio"}
      />
      <span>
        {/* Un prefijo fijo, como la franja del onboarding; el resto es el
            texto que escribe la administración. */}
        <strong>
          {aviso.vencido ? "Plazo vencido:" : "Rol de pagos pendiente:"}
        </strong>{" "}
        {aviso.recordatorio}
      </span>
      <Link
        className="btn btn-sm btn-light"
        to={`/admin/institucional/rol-pagos?anio=${Number(
          aviso.anio,
        )}&mes=${Number(aviso.mes)}`}
      >
        Ver mi rol de pagos
      </Link>
    </div>
  );
}
