import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";

import { sincronizacionNominaService } from "../../../api/sincronizacionNominaService";
import { Icon } from "../../../components/common/Icon/Icon";
import { mensajeDeError } from "../../../utils/errores";
import "./SincronizacionNomina.css";

/*
 * «Nómina» en Configuración › Usuarios (US-021, 16/11/2026).
 *
 * Los perfiles se traen de nómina (sp de empleados activos) cada noche y con
 * «Sincronizar ahora»: nombre, código de empleado, correo y cédula. A quien no
 * tiene cuenta se le crea una inactiva, sin rol; nadie entra hasta que TI o
 * Gestión Humana la active. Aquí se ve la última corrida, los conflictos y las
 * cuentas activas que no están en nómina (solo se reportan).
 */

const fecha = (valor) =>
  valor
    ? new Date(valor).toLocaleString("es-EC", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";

function Cifra({ valor, etiqueta }) {
  return (
    <div className="nomina-sync__cifra">
      <span className="nomina-sync__numero">{valor}</span>
      <span className="mz-small mz-faint">{etiqueta}</span>
    </div>
  );
}

export function SincronizacionNomina() {
  const base = useId();
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [corriendo, setCorriendo] = useState(false);
  const [abierto, setAbierto] = useState(false);

  const cargar = useCallback(() => {
    setError(null);
    sincronizacionNominaService
      .estado()
      .then(setEstado)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar la sincronización.")),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function sincronizar() {
    setCorriendo(true);
    setAviso(null);
    setError(null);
    try {
      const corrida = await sincronizacionNominaService.sincronizar();
      setAviso(
        corrida.estado === "ok"
          ? `Listo: ${corrida.creadas} cuentas creadas, ${corrida.actualizadas} actualizadas y ${corrida.sin_cambios} sin cambios.`
          : `No se pudo sincronizar: ${corrida.error || "falló la lectura de nómina."}`,
      );
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo sincronizar con nómina."));
    } finally {
      setCorriendo(false);
    }
  }

  if (!estado && !error) {
    return (
      <section className="mz-card nomina-sync" aria-busy="true">
        <div className="mz-card-body mz-small mz-faint">
          Cargando la sincronización con nómina…
        </div>
      </section>
    );
  }

  const ultima = estado?.ultima;
  const idTitulo = `${base}-titulo`;
  return (
    <section className="mz-card nomina-sync" aria-labelledby={idTitulo}>
      <div className="mz-card-head nomina-sync__cabeza">
        <h3 id={idTitulo}>
          <Icon name="arrow-repeat" /> Nómina
        </h3>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={sincronizar}
          disabled={corriendo || estado?.corriendo || !estado?.configurada}
        >
          {corriendo || estado?.corriendo
            ? "Sincronizando…"
            : "Sincronizar ahora"}
        </button>
      </div>
      <div className="mz-card-body">
        <p className="mz-desc mb-3">
          Nombre, código de empleado, correo y cédula se traen de nómina cada
          noche. A quien no tiene cuenta se le crea una{" "}
          <strong>inactiva</strong>, sin rol: nadie entra hasta que se active y
          se le deje la contraseña temporal.
        </p>
        <div role="status">
          {aviso && (
            <div className="mz-alert mz-alert--ok">
              <Icon name="check2-circle" />
              {aviso}
            </div>
          )}
          {error && (
            <div className="mz-alert mz-alert--bad">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
        </div>
        {estado && !estado.configurada && (
          <p className="mz-alert mz-alert--warn mb-0">
            <Icon name="exclamation-triangle" />
            La sincronización no está configurada en este servidor.
          </p>
        )}
        {estado?.configurada && !ultima && (
          <p className="mz-small mz-faint mb-0">
            Todavía no se ha sincronizado nunca.
          </p>
        )}
        {ultima && (
          <>
            <p className="mz-small mb-2">
              Última sincronización:{" "}
              <strong>{fecha(ultima.iniciada_en)}</strong>
              {" · "}
              {ultima.automatica ? "automática" : `por ${ultima.actor}`}
              {" · "}
              <span
                className={
                  ultima.estado === "ok" ? "text-success" : "text-danger"
                }
              >
                {ultima.estado_display}
              </span>
              {ultima.error && ` · ${ultima.error}`}
            </p>
            <div className="nomina-sync__cifras">
              <Cifra valor={ultima.empleados} etiqueta="empleados en nómina" />
              <Cifra valor={ultima.creadas} etiqueta="cuentas creadas" />
              <Cifra valor={ultima.actualizadas} etiqueta="actualizadas" />
              <Cifra
                valor={estado.inactivas_desde_nomina}
                etiqueta="inactivas por activar"
              />
              <Cifra valor={ultima.conflictos_total} etiqueta="conflictos" />
              <Cifra
                valor={ultima.fuera_de_nomina_total}
                etiqueta="cuentas fuera de nómina"
              />
            </div>
            {(ultima.conflictos_total > 0 ||
              ultima.fuera_de_nomina_total > 0) && (
              <button
                type="button"
                className="btn btn-link btn-sm px-0 mt-2"
                aria-expanded={abierto}
                aria-controls={`${base}-detalle`}
                onClick={() => setAbierto((a) => !a)}
              >
                <Icon name={abierto ? "chevron-up" : "chevron-down"} />{" "}
                {abierto ? "Ocultar el detalle" : "Ver el detalle"}
              </button>
            )}
            {abierto && (
              <div id={`${base}-detalle`} className="nomina-sync__detalle">
                {ultima.conflictos?.length > 0 && (
                  <>
                    <h4 className="nomina-sync__subtitulo">
                      Conflictos (no se aplicaron)
                    </h4>
                    <ul className="nomina-sync__lista">
                      {ultima.conflictos.map((c, i) => (
                        <li key={`${c.codigo}-${i}`}>
                          <strong>{c.nombre || c.codigo}</strong>
                          {c.codigo && ` (${c.codigo})`}: {c.motivo}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {ultima.fuera_de_nomina?.length > 0 && (
                  <>
                    <h4 className="nomina-sync__subtitulo">
                      Cuentas activas que no están en nómina
                    </h4>
                    <p className="mz-small mz-faint">
                      Solo se reportan: ninguna se desactiva sola.
                    </p>
                    <ul className="nomina-sync__lista">
                      {ultima.fuera_de_nomina.map((c) => (
                        <li key={c.id}>
                          <Link to={`/admin/users/${c.id}`}>{c.nombre}</Link>{" "}
                          <span className="mz-faint">({c.usuario})</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
