import { useEffect, useMemo, useState } from "react";

import { institucionalService } from "../../../api/institucionalService";
import { Icon } from "../../../components/common/Icon/Icon";
import { mensajeDeError } from "../../../utils/errores";
import {
  avisoDelCargo,
  buscarCargos,
  cargosParaElegir,
  textoDelRol,
} from "./cargosDelAlta";
import "./SelectorDeCargo.css";

/** Con cientos de cargos, pintar todos hacía la lista inmanejable: se
 * muestran los primeros y se pide acotar escribiendo. */
const MAXIMO_VISIBLES = 50;

function textoVacantes(vacantes) {
  if (vacantes <= 0) return "sin vacantes";
  return vacantes === 1 ? "1 vacante" : `${vacantes} vacantes`;
}

/**
 * El cargo del organigrama que ocupará la cuenta que se está creando
 * (09/11/2026).
 *
 * Existe por una queja: «en el desplegable de Rol no veo Jefe de Cartera».
 * Los roles de cargo no se eligen a mano (el servidor los descarta): los
 * recibe quien ocupa el cargo. Así que el alta pregunta por el cargo, y dice
 * en seguida qué rol le da.
 *
 * Patrón de `SelectorDePersonas` en modo de una sola elección: un buscador
 * (nunca deshabilitado) y la lista con radios. Lo elegido va DEBAJO de la
 * lista y no encima: arriba empujaba la lista unos 100 px justo cuando se
 * acababa de hacer clic en ella (revisión UX/UI, 09/11/2026).
 *
 * Dos regiones vivas siempre montadas: una dice cuántos cargos hay; la otra,
 * qué se eligió, qué rol da y el aviso que aplique. Los avisos cambian al
 * escribir Nombres y Apellidos, lejos de este campo: sin la región, quien usa
 * lector de pantalla no se enteraría.
 *
 * Los cargos son los de `empresaId`, no los de la pestaña: la cuenta puede
 * nacer en otra empresa del grupo.
 */
export function SelectorDeCargo({
  id = "cargo",
  empresaId,
  cargo,
  onCambio,
  nombreCompleto = "",
}) {
  const [cargos, setCargos] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState("");
  const [vez, setVez] = useState(0);
  const idAyuda = `${id}-ayuda`;
  const idLista = `${id}-lista`;
  const idElegido = `${id}-elegido`;

  useEffect(() => {
    let vigente = true;
    setCargos(null);
    setError(null);
    // `Promise.resolve()` delante: si el servicio fallara al armar la
    // petición, el error también acaba en el aviso con «Reintentar».
    Promise.resolve()
      .then(() => institucionalService.organigrama({ empresa: empresaId }))
      .then((datos) => vigente && setCargos(cargosParaElegir(datos)))
      .catch((err) => {
        if (!vigente) return;
        setCargos([]);
        setError(
          mensajeDeError(
            err,
            "No se pudieron cargar los cargos del organigrama.",
          ),
        );
      });
    return () => {
      vigente = false;
    };
  }, [empresaId, vez]);

  const encontrados = useMemo(
    () => buscarCargos(cargos, texto),
    [cargos, texto],
  );
  const visibles = encontrados.slice(0, MAXIMO_VISIBLES);
  const aviso = avisoDelCargo(cargo, nombreCompleto);
  const anuncio = cargo
    ? [`Elegido: ${cargo.etiqueta}.`, textoDelRol(cargo), aviso?.texto]
        .filter(Boolean)
        .join(" ")
    : "";

  let estado;
  if (cargos === null) estado = "Cargando cargos…";
  else if (error) estado = "";
  else if (cargos.length === 0)
    estado = "Esta empresa todavía no tiene cargos activos en su organigrama.";
  else if (encontrados.length === 0)
    estado = "Ningún cargo coincide con la búsqueda.";
  else if (encontrados.length > MAXIMO_VISIBLES)
    estado = `${encontrados.length} cargos: se muestran los primeros ${MAXIMO_VISIBLES}. Escriba para acotar.`;
  else
    estado = `${encontrados.length} ${encontrados.length === 1 ? "cargo encontrado" : "cargos encontrados"}.`;

  return (
    <fieldset
      className="ua-cargo"
      aria-describedby={[idAyuda, cargo && idElegido].filter(Boolean).join(" ")}
    >
      <legend className="ua-cargo__titulo">
        Cargo en el organigrama (opcional)
      </legend>
      <p id={idAyuda} className="form-text mt-0">
        Si la persona ocupa un cargo, elíjalo: la cuenta recibe el rol del cargo
        y sus permisos, y aparece en el organigrama. Queda anotado en la
        bitácora del organigrama.
      </p>

      <label htmlFor={id} className="form-label">
        Buscar cargo
      </label>
      <input
        id={id}
        type="search"
        className="form-control"
        value={texto}
        placeholder="Cargo o unidad, p. ej. Jefe de Cartera"
        autoComplete="off"
        aria-controls={idLista}
        onChange={(e) => setTexto(e.target.value)}
      />
      {/* Siempre montado: el número de resultados se anuncia al escribir. */}
      <p className="mz-small mz-faint mb-0 mt-1" role="status">
        {estado}
      </p>
      {error && (
        <div className="mz-alert mz-alert--bad mt-2" role="alert">
          <Icon name="x-octagon" />
          <span className="flex-grow-1">{error}</span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setVez((v) => v + 1)}
          >
            Reintentar
          </button>
        </div>
      )}
      <ul
        id={idLista}
        className="ua-cargo__resultados"
        aria-label="Cargos del organigrama"
        hidden={visibles.length === 0}
      >
        {visibles.map((c) => (
          <li key={c.id}>
            <label className="ua-cargo__resultado">
              <input
                type="radio"
                name={`${id}-eleccion`}
                className="form-check-input"
                checked={cargo?.id === c.id}
                onChange={() => onCambio(c)}
              />
              <span className="ua-cargo__nombre">
                {c.etiqueta}
                <span className={c.vacantes > 0 ? "mz-faint" : "mz-warn"}>
                  {" "}
                  · {textoVacantes(c.vacantes)}
                </span>
                {/* Sin rol, ocuparlo no da permisos: se ve antes de elegir. */}
                {!c.rol && <span className="mz-warn"> · sin rol</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>

      {/* Siempre montada y fuera de la vista: anuncia la elección y cada
          cambio del aviso (también los que provoca escribir el nombre). */}
      <p className="visually-hidden" role="status">
        {anuncio}
      </p>

      {cargo && (
        <div id={idElegido} className="ua-cargo__elegido">
          <div className="ua-cargo__ficha">
            <span className="ua-cargo__nombre">{cargo.etiqueta}</span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => {
                onCambio(null);
                // El botón desaparece: el foco va al buscador.
                document.getElementById(id)?.focus();
              }}
            >
              Quitar <span className="visually-hidden">{cargo.etiqueta}</span>
            </button>
          </div>
          <p className="mz-small mb-0 mt-1">
            <Icon name="shield-check" /> {textoDelRol(cargo)}
          </p>
          {/* Sin `role`: lo anuncia la región de arriba, y con dos se
              leería dos veces. */}
          {aviso && (
            <div
              className={`mz-alert ${
                aviso.tipo === "reemplaza" ? "mz-alert--info" : "mz-alert--warn"
              } mt-2 mb-0`}
            >
              <Icon
                name={
                  aviso.tipo === "reemplaza"
                    ? "person-check"
                    : "exclamation-triangle"
                }
              />
              <span>{aviso.texto}</span>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}
