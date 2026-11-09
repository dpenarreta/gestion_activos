import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import {
  NOVA_MENSAJE_INICIO,
  errorDeNova,
  novaService,
} from "../../api/novaService";
import { getVisibleAdminMenu } from "../../components/admin/AdminSidebar/staticAdminMenu";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { useAuth } from "../../hooks/useAuth";
import "./GestionHumana.css";
import { AvisoIa, AvisoSinIa } from "./Nova/AvisosNova";
import { Encabezado } from "./Tareas/ContextoTareas";

/** Las entradas con dirección, recorriendo las secciones del menú. */
function conDireccion(items) {
  return items.flatMap((item) => [
    ...(item.path ? [item] : []),
    ...conDireccion(item.children ?? []),
  ]);
}

/**
 * La frase de Nova del día: sus tareas y su carga, en una línea. Si no hay
 * IA, la del servidor sin IA (las mismas reglas de Nexo), marcada como tal.
 */
export function FraseNova() {
  const [estado, setEstado] = useState({ cargando: true });
  const vigente = useRef(true);

  const cargar = useCallback(() => {
    setEstado({ cargando: true });
    novaService
      .mensajeInicio()
      .then((datos) => vigente.current && setEstado({ datos }))
      .catch(
        (err) =>
          vigente.current &&
          setEstado({
            error: errorDeNova(err, "No se pudo cargar el mensaje de Nova.")
              .mensaje,
          }),
      );
  }, []);

  useEffect(() => {
    vigente.current = true;
    cargar();
    return () => {
      vigente.current = false;
    };
  }, [cargar]);

  const { cargando, datos, error } = estado;
  return (
    <section className="mz-card" aria-labelledby="gh-nova-titulo">
      <div className="mz-card-head">
        <h3 id="gh-nova-titulo">
          <Icon name="stars" /> Nova
        </h3>
      </div>
      {/* Sin región viva propia: anuncian el `status` y el `alert` de
          `EstadoDeCarga`. */}
      <div className="mz-card-body mz-stack">
        <EstadoDeCarga
          cargando={cargando}
          error={error}
          onReintentar={cargar}
        />
        {datos && (
          <>
            <p className="mz-strong mb-0">{datos.mensaje}</p>
            {/* Las mismas marcas que el análisis de los KPI. */}
            {datos.con_ia ? <AvisoIa /> : <AvisoSinIa mensaje={datos.aviso} />}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * La entrada del módulo. Con la frase de Nova (`nova.mensaje_inicio`) es una
 * portada: la frase del día y los accesos que la persona puede abrir. Sin
 * ella, lleva directo a la primera pantalla que puede abrir: quien solo
 * consulta Ingresos y salidas no tiene acceso a Días laborados, y quien solo
 * trabaja Tareas no tiene Control operativo; mandarlo ahí sería un «sin
 * acceso» de entrada.
 */
export function InicioGestionHumana() {
  const { user } = useAuth();
  const permisos = user?.permissions ?? [];
  const entradas = conDireccion(
    getVisibleAdminMenu(permisos, "gestion_humana").filter(
      (entrada) => entrada.modulo === "gestion_humana",
    ),
  );
  if (!permisos.includes(NOVA_MENSAJE_INICIO)) {
    return <Navigate to={entradas[0]?.path ?? "/403"} replace />;
  }
  return (
    <div className="gh-page mz-stack">
      <Encabezado
        titulo="Gestión Humana"
        descripcion="Su resumen del día y los accesos del módulo."
      />
      <FraseNova />
      <nav className="mz-card" aria-labelledby="gh-accesos-titulo">
        <div className="mz-card-head">
          <h3 id="gh-accesos-titulo">Accesos</h3>
        </div>
        <div className="mz-card-body">
          {entradas.length ? (
            <ul className="gh-accesos">
              {entradas.map((entrada) => (
                <li key={entrada.id}>
                  <Link to={entrada.path} className="btn btn-outline-secondary">
                    {entrada.icon && <Icon name={entrada.icon} />}{" "}
                    {entrada.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mz-empty mb-0">
              No tiene pantallas de Gestión Humana disponibles.
            </p>
          )}
        </div>
      </nav>
    </div>
  );
}
