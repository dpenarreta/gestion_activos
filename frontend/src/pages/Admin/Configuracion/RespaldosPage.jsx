import { useEffect, useState } from "react";

import { respaldosService } from "../../../api/respaldosService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import { formatearFecha } from "../../../utils/formato";

const BREADCRUMB_ITEMS = [
  { label: "Administración" },
  { label: "Configuración" },
  { label: "Respaldos" },
];

const DIAS = [
  [0, "Lunes"],
  [1, "Martes"],
  [2, "Miércoles"],
  [3, "Jueves"],
  [4, "Viernes"],
  [5, "Sábado"],
  [6, "Domingo"],
];

/**
 * Cuándo se respalda solo.
 *
 * El «cuándo» se decide aquí y no en el programador de tareas del servidor, por
 * lo mismo que la frecuencia del resumen de alertas: el programador es
 * infraestructura, y cambiar «semanal» por «diaria» no debería necesitar un
 * administrador de servidores. La tarea del sistema corre cada hora, siempre
 * igual, y lo que se configura en esta pantalla decide si toca.
 */
export function RespaldosPage() {
  // Su propio permiso, separado de la apariencia del sistema: apagar el
  // respaldo automático decide de cuándo se puede volver si algo se pierde.
  const puedeEditar = usePermission("configuracion.respaldos");
  const [politica, setPolitica] = useState(null);
  const [error, setError] = useState(null);
  const [guardado, setGuardado] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    respaldosService
      .politica()
      .then(setPolitica)
      .catch((err) =>
        setError(
          mensajeDeError(
            err,
            "No se pudo cargar la configuración de respaldos.",
          ),
        ),
      );
  }, []);

  function fijar(campo, valor) {
    setGuardado(false);
    setPolitica((actual) => ({ ...actual, [campo]: valor }));
  }

  async function guardar(evento) {
    evento.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const actualizada = await respaldosService.guardar({
        activo: politica.activo,
        frecuencia: politica.frecuencia,
        dia_semanal: Number(politica.dia_semanal),
        hora: politica.hora,
        destino: politica.destino,
        conservar: Number(politica.conservar),
      });
      setPolitica(actualizada);
      setGuardado(true);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la configuración."));
    } finally {
      setIsSaving(false);
    }
  }

  if (error && !politica) {
    return (
      <div>
        <Breadcrumbs items={BREADCRUMB_ITEMS} />
        <div className="alert alert-danger">{error}</div>
      </div>
    );
  }
  if (!politica) {
    return <div className="text-muted">Cargando…</div>;
  }

  const esSemanal = politica.frecuencia === "semanal";

  return (
    <div>
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <h2 className="mb-1">Respaldos</h2>
      <p className="text-muted">
        La base y los adjuntos —facturas y actas firmadas— no se regeneran. Aquí
        se decide cada cuánto se copian solos.
      </p>

      {error && <div className="alert alert-danger">{error}</div>}
      {guardado && (
        <div className="alert alert-success">
          Configuración guardada.
          {politica.proximo &&
            ` El próximo respaldo será el ${politica.proximo}.`}
        </div>
      )}

      <div className="row g-4">
        <div className="col-12 col-lg-7">
          <form onSubmit={guardar} className="row g-3">
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  id="resp-activo"
                  type="checkbox"
                  className="form-check-input"
                  disabled={!puedeEditar}
                  checked={politica.activo}
                  onChange={(e) => fijar("activo", e.target.checked)}
                />
                <label className="form-check-label" htmlFor="resp-activo">
                  Respaldar automáticamente
                </label>
              </div>
              <div className="form-text">
                Apagado, nadie respalda nada: el comando sigue estando para
                lanzarlo a mano.
              </div>
            </div>

            <div className="col-12 col-md-4">
              <label className="form-label" htmlFor="resp-frecuencia">
                Cada cuánto
              </label>
              <select
                id="resp-frecuencia"
                className="form-select"
                disabled={!puedeEditar}
                value={politica.frecuencia}
                onChange={(e) => fijar("frecuencia", e.target.value)}
              >
                <option value="diaria">Todos los días</option>
                <option value="semanal">Una vez por semana</option>
              </select>
            </div>

            {esSemanal && (
              <div className="col-12 col-md-4">
                <label className="form-label" htmlFor="resp-dia">
                  Qué día
                </label>
                <select
                  id="resp-dia"
                  className="form-select"
                  disabled={!puedeEditar}
                  value={politica.dia_semanal}
                  onChange={(e) => fijar("dia_semanal", e.target.value)}
                >
                  {DIAS.map(([valor, nombre]) => (
                    <option key={valor} value={valor}>
                      {nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="col-12 col-md-4">
              <label className="form-label" htmlFor="resp-hora">
                A partir de qué hora
              </label>
              <input
                id="resp-hora"
                type="time"
                className="form-control"
                disabled={!puedeEditar}
                value={(politica.hora || "").slice(0, 5)}
                onChange={(e) => fijar("hora", e.target.value)}
              />
              <div className="form-text">
                De madrugada: un respaldo es lento y bloquea.
              </div>
            </div>

            <div className="col-12 col-md-8">
              <label className="form-label" htmlFor="resp-destino">
                Carpeta de destino
              </label>
              <input
                id="resp-destino"
                className="form-control"
                disabled={!puedeEditar}
                value={politica.destino}
                onChange={(e) => fijar("destino", e.target.value)}
              />
              <div className="form-text">
                Conviene que esté fuera de esta máquina: un respaldo que vive
                junto a lo que protege no protege de perderla.
              </div>
            </div>

            <div className="col-12 col-md-4">
              <label className="form-label" htmlFor="resp-conservar">
                Cuántos conservar
              </label>
              <input
                id="resp-conservar"
                type="number"
                min="1"
                className="form-control"
                disabled={!puedeEditar}
                value={politica.conservar}
                onChange={(e) => fijar("conservar", e.target.value)}
              />
              <div className="form-text">
                Los más viejos se retiran al hacer uno nuevo.
              </div>
            </div>

            {puedeEditar && (
              <div className="col-12">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSaving}
                >
                  {isSaving ? "Guardando…" : "Guardar"}
                </button>
              </div>
            )}
          </form>
        </div>

        <div className="col-12 col-lg-5">
          <h6>Estado</h6>
          <dl className="row mb-0">
            <dt className="col-6">Último respaldo</dt>
            <dd className="col-6">
              {politica.ultimo_en_disco
                ? formatearFecha(politica.ultimo_en_disco)
                : "Ninguno todavía"}
            </dd>
            <dt className="col-6">Próximo</dt>
            <dd className="col-6">
              {politica.activo
                ? (politica.proximo ?? "Sin determinar")
                : "Respaldo automático apagado"}
            </dd>
          </dl>
          <p className="form-text mt-3">
            {/* Lo que casi nadie hace, y lo único que convierte un archivo en un
                respaldo de verdad. */}
            Un respaldo que nunca se restauró no es un respaldo: pruebe la
            restauración en una base aparte de vez en cuando.
          </p>
        </div>
      </div>
    </div>
  );
}
