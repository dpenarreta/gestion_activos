import { useEffect, useState } from "react";

import { herramientasService } from "../../api/herramientasService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";

/**
 * Quién tiene acceso a una herramienta, en su editor del catálogo: se agregan
 * y quitan personas, y cada cambio se refleja en sus «Mis herramientas».
 */
export function AccesosHerramienta({ herramienta, onCambio }) {
  const [usuarios, setUsuarios] = useState(null);
  const [buscar, setBuscar] = useState("");
  const [resultados, setResultados] = useState([]);
  const [elegida, setElegida] = useState(null);
  const [cuenta, setCuenta] = useState("");
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    herramientasService
      .usuarios(herramienta.id)
      .then(setUsuarios)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar quién la usa.")),
      );
  }, [herramienta.id]);

  // Personas de la empresa que coinciden con lo escrito (con una pausa corta).
  useEffect(() => {
    const texto = buscar.trim();
    if (texto.length < 2 || elegida) {
      setResultados([]);
      return undefined;
    }
    let vigente = true;
    const espera = setTimeout(() => {
      herramientasService
        .personas(texto)
        .then((lista) => vigente && setResultados(lista))
        .catch(() => vigente && setResultados([]));
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(espera);
    };
  }, [buscar, elegida]);

  async function hacer(accion) {
    setTrabajando(true);
    setError(null);
    try {
      setUsuarios(await accion());
      onCambio?.();
      return true;
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el cambio."));
      return false;
    } finally {
      setTrabajando(false);
    }
  }

  async function agregar() {
    if (!elegida) return;
    const hecho = await hacer(() =>
      herramientasService.darAcceso(herramienta.id, elegida.id, cuenta),
    );
    if (hecho) {
      setElegida(null);
      setBuscar("");
      setCuenta("");
    }
  }

  const yaTiene = new Set((usuarios ?? []).map((u) => u.id));

  return (
    <section className="accesos-herramienta" aria-labelledby="accesos-titulo">
      <h4 id="accesos-titulo">
        Personas con acceso{usuarios ? ` (${usuarios.length})` : ""}
      </h4>
      <p className="form-text mt-0">
        Lo que agregue o quite aquí se ve en «Mis herramientas» de cada persona.
      </p>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {usuarios && usuarios.length === 0 && (
        <p className="mz-faint mb-0">Nadie la usa todavía.</p>
      )}
      {usuarios && usuarios.length > 0 && (
        <ul className="perfil-cargo-lista">
          {usuarios.map((u) => (
            <li key={u.id}>
              <span className="perfil-cargo-lista__nombre">
                {u.nombre}
                <small className="mz-faint"> · {u.correo}</small>
                {u.cuenta && (
                  <small className="mz-faint"> · cuenta: {u.cuenta}</small>
                )}
                {!u.activo && (
                  <span className="perfil-cargo-estado perfil-cargo-estado--vacio ms-2">
                    Cuenta deshabilitada
                  </span>
                )}
              </span>
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                aria-label={`Quitar a ${u.nombre}`}
                disabled={trabajando}
                onClick={() =>
                  hacer(() =>
                    herramientasService.quitarAcceso(herramienta.id, u.id),
                  )
                }
              >
                <Icon name="person-dash" /> Quitar
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="accesos-herramienta__agregar">
        <div className="accesos-herramienta__buscar">
          <label className="form-label mz-small" htmlFor="accesos-buscar">
            Agregar persona
          </label>
          {elegida ? (
            <div className="accesos-herramienta__elegida">
              <span>
                <Icon name="person-check" /> {elegida.nombre}
              </span>
              <button
                type="button"
                className="btn btn-link btn-sm p-0"
                onClick={() => {
                  setElegida(null);
                  setBuscar("");
                }}
              >
                Cambiar
              </button>
            </div>
          ) : (
            <input
              id="accesos-buscar"
              type="search"
              className="form-control form-control-sm"
              placeholder="Nombre o correo…"
              autoComplete="off"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
            />
          )}
          {resultados.length > 0 && (
            <ul className="accesos-herramienta__resultados" role="listbox">
              {resultados.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    disabled={yaTiene.has(p.id)}
                    onClick={() => setElegida(p)}
                  >
                    {p.nombre}{" "}
                    <small className="mz-faint">
                      {yaTiene.has(p.id)
                        ? "· ya tiene acceso"
                        : `· ${p.correo}`}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <label className="form-label mz-small" htmlFor="accesos-cuenta">
            Cuenta o usuario (opcional)
          </label>
          <input
            id="accesos-cuenta"
            className="form-control form-control-sm"
            maxLength={150}
            value={cuenta}
            onChange={(e) => setCuenta(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm align-self-end"
          disabled={!elegida || trabajando}
          onClick={agregar}
        >
          <Icon name="person-plus" /> Agregar
        </button>
      </div>
    </section>
  );
}
