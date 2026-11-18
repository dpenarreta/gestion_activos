/*
 * US-033. El tope de una sanción en porcentaje del sueldo, por empresa
 * (`llamados.configurar`). Vacío = sin tope. La cifra legal no la asume el
 * sistema: la define Gestión Humana.
 */
import { useEffect, useState } from "react";

import { llamadosService } from "../../../api/llamadosService";
import { Campo } from "../../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import {
  erroresPorCampo,
  hayErroresGenerales,
  mensajeDeError,
} from "../../../utils/errores";
import { ErrorEnLinea, fechaHora } from "../comunes";
import { nombreDe, porcentajeANumero } from "./llamadosComunes";

const comoTexto = (tope) =>
  tope === null || tope === undefined || tope === ""
    ? ""
    : String(tope).replace(".", ",");

export function TopeDeSancion({
  config,
  cargaError,
  onReintentar,
  onGuardado,
}) {
  const [valor, setValor] = useState(comoTexto(config?.tope_porcentaje));
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);

  // Llega (o se recarga) la configuración: el campo parte de ella.
  useEffect(() => {
    if (config) setValor(comoTexto(config.tope_porcentaje));
  }, [config]);

  async function guardar(evento) {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    const texto = valor.trim();
    let tope = null;
    if (texto !== "") {
      tope = porcentajeANumero(texto);
      if (tope === null) {
        setErrores({
          tope_porcentaje:
            "Indique un porcentaje mayor que 0 y hasta 100, con hasta dos decimales, o déjelo vacío para no poner tope.",
        });
        return;
      }
    }
    setErrores({});
    setGuardando(true);
    try {
      const datos = await llamadosService.guardarConfiguracion(tope);
      onGuardado(datos);
      setValor(comoTexto(datos.tope_porcentaje));
      setAviso(
        datos.tope_porcentaje === null || datos.tope_porcentaje === undefined
          ? "Quedó sin tope."
          : "El tope quedó guardado.",
      );
    } catch (err) {
      const campos = erroresPorCampo(err);
      setErrores(campos);
      setError(
        hayErroresGenerales(err) || !Object.keys(campos).length
          ? mensajeDeError(err, "No se pudo guardar el tope.")
          : "Revise el campo marcado.",
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="mz-card p-3" aria-labelledby="tope-titulo">
      <h3 id="tope-titulo" className="h6">
        Tope de la sanción en porcentaje
      </h3>
      <EstadoDeCarga
        cargando={!config && !cargaError}
        error={cargaError}
        onReintentar={onReintentar}
      />
      {config && (
        <form onSubmit={guardar} noValidate className="mz-stack">
          {error && <ErrorEnLinea mensaje={error} />}
          {aviso && (
            <p className="mz-alert mz-alert--ok mb-0" role="status">
              {aviso}
            </p>
          )}
          <Campo
            id="tope-porcentaje"
            etiqueta="Tope de sanción en % del sueldo"
            error={errores.tope_porcentaje}
            ayuda="Vacío = sin tope. Una sanción en porcentaje que lo supere no se emite. La cifra legal la define Gestión Humana; el sistema no la asume."
          >
            <input
              className="form-control"
              inputMode="decimal"
              value={valor}
              disabled={guardando}
              onChange={(e) => setValor(e.target.value)}
            />
          </Campo>
          {config.actualizado_en && (
            <p className="mz-small mz-faint mb-0">
              Última actualización: {fechaHora(config.actualizado_en)}
              {config.actualizado_por
                ? ` · ${nombreDe(config.actualizado_por)}`
                : ""}
            </p>
          )}
          <div>
            <button
              type="submit"
              className="btn btn-outline-primary mz-tactil"
              disabled={guardando}
            >
              {guardando ? "Guardando…" : "Guardar tope"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
