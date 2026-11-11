import { Link } from "react-router-dom";

import { Icon } from "../../components/common/Icon/Icon";
import { useAuth } from "../../hooks/useAuth";
import {
  PERMISOS_PRIVACIDAD,
  PERMISOS_VER_TEXTOS,
  RUTA_ACEPTACIONES,
  RUTA_TEXTOS,
  rutaDeAceptaciones,
  rutaDeTexto,
} from "./privacidadComunes";

/**
 * Donde antes se editaba un texto de protección de datos (Rol de pagos,
 * Códigos de conducta, Configuración), el aviso de que desde US-004
 * (11/11/2026, CA-7) se edita en un solo lugar, con el enlace. Quien no
 * puede abrir «Textos» lee el aviso sin enlace (llevaría a un 403).
 */
export function SeEditaEnProteccionDeDatos({
  que,
  clave,
  plural = true,
  enlaces,
}) {
  const { user } = useAuth();
  const permisos = user?.permissions || [];
  const puede = PERMISOS_VER_TEXTOS.some((p) => permisos.includes(p));
  // Con `enlaces` (varios textos, como en el rol de pagos), un enlace por
  // texto, cada uno a su tarjeta en «Textos».
  if (enlaces?.length) {
    return (
      <div className="mz-alert mz-alert--info mb-0">
        <Icon name="shield-lock" />
        <div>
          <p className="mb-1">
            {que} {plural ? "se editan" : "se edita"} en Protección de datos →
            Textos{puede ? ":" : "."}
          </p>
          {puede && (
            <ul className="mb-0">
              {enlaces.map((e) => (
                <li key={e.clave}>
                  <Link to={rutaDeTexto(e.clave)}>{e.nombre}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }
  return (
    <p className="mz-alert mz-alert--info mb-0">
      <Icon name="shield-lock" />
      <span>
        {que} {plural ? "se editan" : "se edita"} en{" "}
        {puede ? (
          <Link to={clave ? rutaDeTexto(clave) : RUTA_TEXTOS}>
            Protección de datos → Textos
          </Link>
        ) : (
          "Protección de datos → Textos"
        )}
        .
      </span>
    </p>
  );
}

/** Lo mismo para las aceptaciones de un texto (se consultan allí). */
export function SeConsultaEnProteccionDeDatos({ que, clave, plural = true }) {
  const { user } = useAuth();
  const permisos = user?.permissions || [];
  const puede = PERMISOS_PRIVACIDAD.some((p) => permisos.includes(p));
  return (
    <p className="mz-alert mz-alert--info mb-0">
      <Icon name="shield-lock" />
      <span>
        {que} {plural ? "se consultan" : "se consulta"} en{" "}
        {puede ? (
          <Link to={clave ? rutaDeAceptaciones(clave) : RUTA_ACEPTACIONES}>
            Protección de datos → Aceptaciones
          </Link>
        ) : (
          "Protección de datos → Aceptaciones"
        )}
        .
      </span>
    </p>
  );
}
