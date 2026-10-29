import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { nominaService } from "../../../api/nominaService";
import { useAuth } from "../../../hooks/useAuth";
import { VentanaAviso } from "../AvisoInicioSesion/AvisoInicioSesion";

const CLAVE = "aviso_rol.visto";

function clave(usuario, aviso) {
  return `${CLAVE}.${usuario}.${aviso.anio}-${aviso.mes}`;
}

function yaVisto(usuario, aviso) {
  try {
    return sessionStorage.getItem(clave(usuario, aviso)) === "1";
  } catch {
    return false;
  }
}

function marcarVisto(usuario, aviso) {
  try {
    sessionStorage.setItem(clave(usuario, aviso), "1");
  } catch {
    /* Sin almacenamiento puede volver a salir en esta sesión: no es grave. */
  }
}

const NORMAL = { icono: "file-earmark-text", texto: "Rol de pagos" };
const VENCIDO = { icono: "exclamation-triangle-fill", texto: "Plazo vencido" };

/**
 * El aviso del rol de pagos al iniciar sesión (aviso del rol de pagos,
 * 29/10/2026). Desde el primer día hábil del mes, a quien está habilitado y
 * todavía no aceptó su rol del mes anterior, el servidor le dice que lo
 * muestre; pasados los días hábiles permitidos, con el mensaje de plazo
 * vencido. Misma ventana que el aviso al iniciar sesión.
 *
 * «Ver mi rol de pagos» lo lleva a la consulta con ese período ya elegido;
 * «Recordarme después» (o la X o Escape; un clic fuera no lo cierra) lo cierra. En ambos
 * casos no vuelve a salir en esta sesión, pero sí en el próximo inicio de
 * sesión (el cierre de sesión limpia `sessionStorage`) hasta que lo acepte.
 * Si la consulta falla, no se muestra nada. `onTerminado` avisa cuando ya no
 * hay aviso que mostrar (para que el siguiente salga después, no encima).
 */
export function AvisoRolPagos({ onTerminado }) {
  const { user } = useAuth();
  const usuario = user?.id;
  const navigate = useNavigate();
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    if (!usuario) return undefined;
    let vigente = true;
    Promise.resolve(nominaService.aviso?.())
      .then((datos) => {
        if (!vigente) return;
        if (
          datos?.mostrar &&
          datos.titulo &&
          Number(datos.anio) &&
          Number(datos.mes) &&
          !yaVisto(usuario, datos)
        ) {
          setAviso(datos);
        } else {
          onTerminado?.();
        }
      })
      .catch(() => vigente && onTerminado?.());
    return () => {
      vigente = false;
    };
    // `onTerminado` cambia en cada render del layout; basta con el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  if (!aviso) return null;

  function cerrar() {
    marcarVisto(usuario, aviso);
    setAviso(null);
    onTerminado?.();
  }

  function verRol() {
    // La ruta se arma aquí con el año y el mes (números), no con un enlace
    // que llegue del servidor.
    const destino = `/admin/institucional/rol-pagos?anio=${Number(
      aviso.anio,
    )}&mes=${Number(aviso.mes)}`;
    // Sin `onTerminado`: el siguiente aviso («Mi perfil») no se abre encima
    // del rol que la persona acaba de pedir; saldrá en el próximo inicio de
    // sesión (auditoría UX/UI, 29/10/2026).
    marcarVisto(usuario, aviso);
    setAviso(null);
    navigate(destino);
  }

  return (
    <VentanaAviso
      titulo={aviso.titulo}
      contenido={aviso.mensaje}
      etiqueta={aviso.vencido ? VENCIDO : NORMAL}
      variante={aviso.vencido ? "advertencia" : undefined}
      onCerrar={cerrar}
      etiquetaCerrar="Cerrar y recordarme después"
      acciones={
        <>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={cerrar}
          >
            Recordarme después
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={verRol}
            data-autofocus
          >
            Ver mi rol de pagos
          </button>
        </>
      }
    />
  );
}
