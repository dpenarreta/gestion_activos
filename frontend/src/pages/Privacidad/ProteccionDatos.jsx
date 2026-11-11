/*
 * «Protección de datos» (US-004, 11/11/2026): una entrada del menú con tres
 * pestañas, cada una con su dirección y su permiso.
 *
 * - «Solicitudes»: la bandeja de derechos de siempre (`privacidad.ver` o
 *   `.atender`).
 * - «Textos»: todos los textos sobre datos personales que muestra la intranet,
 *   por módulo y sección (`privacidad.ver`, `.atender` o `.textos`; editarlos,
 *   `privacidad.textos`).
 * - «Aceptaciones»: el registro común de quién aceptó qué (`privacidad.ver` o
 *   `.atender`).
 *
 * El Administrador de TI solo tiene `privacidad.textos` (decisión del
 * 11/11/2026): ve la entrada y solo la pestaña «Textos». El servidor vuelve a
 * exigir cada permiso; ocultar una pestaña no es la barrera.
 */
import { Navigate } from "react-router-dom";

import { AdminTabs } from "../../components/admin/AdminTabs/AdminTabs";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { useAuth } from "../../hooks/useAuth";
import { pestanasDeProteccion } from "./privacidadComunes";
import "./Privacidad.css";

/** `/admin/privacidad`: a la primera pestaña que se puede abrir. */
export function ProteccionDatosInicio() {
  const { user, isAuthenticated, isInitializing } = useAuth();
  if (isInitializing) return <EstadoDeCarga cargando />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  const [primera] = pestanasDeProteccion(user?.permissions || []);
  return <Navigate to={primera ? primera.path : "/403"} replace />;
}

/** Lo que hay en la pantalla, según las pestañas que la persona ve. */
const QUE_HAY = {
  solicitudes: "las solicitudes de derechos sobre datos personales (LOPDP)",
  textos: "los textos que la intranet muestra sobre ellos",
  aceptaciones: "quién los aceptó",
};

export function descripcion(pestanas) {
  const partes = pestanas.map((p) => QUE_HAY[p.key]).filter(Boolean);
  if (partes.length === 1 && partes[0] === QUE_HAY.textos) {
    return "Los textos que la intranet muestra sobre los datos personales de las personas.";
  }
  const lista =
    partes.length > 1
      ? `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`
      : (partes[0] ?? "");
  return lista ? `${lista[0].toUpperCase()}${lista.slice(1)}.` : "";
}

/** El encabezado, las pestañas que se pueden abrir y el panel de `seccion`. */
export function ProteccionDatosMarco({ seccion, children }) {
  const { user } = useAuth();
  const pestanas = pestanasDeProteccion(user?.permissions || []);
  return (
    <div className="mz-stack pv-proteccion">
      <div className="mz-view-head">
        <div>
          <h2>Protección de datos</h2>
          <p className="mz-desc">{descripcion(pestanas)}</p>
        </div>
      </div>
      {/* Con una sola pestaña (solo `privacidad.textos`) no hay nada que
          elegir: sin la barra. */}
      {pestanas.length > 1 && <AdminTabs tabs={pestanas} />}
      <div
        role={pestanas.length > 1 ? "tabpanel" : undefined}
        id={`admin-tabpanel-${seccion}`}
        aria-labelledby={
          pestanas.length > 1 ? `admin-tab-${seccion}` : undefined
        }
        className="mz-stack"
      >
        {children}
      </div>
    </div>
  );
}
