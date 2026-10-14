import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  categoriasActivoService,
  tiposDispositivoService,
} from "../../../api/activosService";
import { CaracteristicasDelTipo } from "../../../components/activos/CaracteristicasDelTipo/CaracteristicasDelTipo";
import { Icon } from "../../../components/common/Icon/Icon";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import "./Activos.css";

const FILTROS_INICIALES = { q: "" };
const VACIO = {
  nombre: "",
  codigo: "",
  descripcion: "",
  categoria: "",
  activo: true,
};

/**
 * Catálogo de tipos de dispositivo.
 *
 * Se edita en un diálogo y no en una página aparte porque son tres campos y
 * el flujo natural es corregir un nombre sin perder de vista la lista. El
 * `codigo` es el dato delicado: entra en el código de barras de cada activo
 * de ese tipo, así que cambiarlo no renumera los ya emitidos.
 */
export function TiposDispositivoList() {
  const puedeEditar = usePermission("activos.editar");
  const [busqueda, setBusqueda] = useState("");
  const [enEdicion, setEnEdicion] = useState(null);
  const cargar = useCallback(
    (params) => tiposDispositivoService.list(params),
    [],
  );
  const listado = useListadoPaginado(
    cargar,
    FILTROS_INICIALES,
    "No se pudo cargar el catálogo de tipos.",
  );

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Tipos de dispositivo</h2>
          <p className="mz-desc">
            Qué es cada equipo del inventario. El código del tipo entra en el
            código de barras de cada activo.
          </p>
        </div>
        {puedeEditar && (
          <div className="mz-view-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setEnEdicion(VACIO)}
            >
              <Icon name="plus-lg" /> Nuevo tipo
            </button>
          </div>
        )}
      </div>

      <form
        className="mz-filter-bar"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          listado.actualizarFiltros({ q: busqueda });
        }}
      >
        <label className="mz-fb-search">
          <Icon name="search" />
          <span className="visually-hidden">Buscar tipos de dispositivo</span>
          <input
            type="search"
            placeholder="Buscar por nombre o código"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-outline-secondary btn-sm">
          Buscar
        </button>
      </form>

      {listado.error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {listado.error}
        </div>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table mz-table--ancha">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Descripción</th>
              <th className="num">Activos</th>
              <th>Política</th>
              <th>Estado</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((tipo) => (
              <tr key={tipo.id}>
                <td>
                  <code className="codigo-barras">{tipo.codigo}</code>
                </td>
                <td className="mz-strong">{tipo.nombre}</td>
                <td>
                  {tipo.categoria_nombre || (
                    <span className="mz-faint">Sin clasificar</span>
                  )}
                </td>
                <td className="mz-faint">{tipo.descripcion || "—"}</td>
                <td className="num">
                  {tipo.total_activos > 0 ? (
                    <Link to={`/admin/activos?tipo=${tipo.id}`}>
                      {tipo.total_activos}
                    </Link>
                  ) : (
                    0
                  )}
                </td>
                <td>
                  {tipo.tiene_politica ? (
                    <span className="mz-pill mz-pill--neutral">Propia</span>
                  ) : (
                    <span className="mz-faint mz-small">Usa la global</span>
                  )}
                </td>
                <td>
                  <span
                    className={`mz-pill ${tipo.activo ? "mz-pill--ok" : "mz-pill--neutral"}`}
                  >
                    {tipo.activo ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="acciones">
                  {puedeEditar && (
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      onClick={() => setEnEdicion(tipo)}
                    >
                      Editar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={8}>Sin tipos de dispositivo registrados</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Paginacion
        total={listado.total}
        pagina={listado.pagina}
        hasNext={listado.hasNext}
        hasPrevious={listado.hasPrevious}
        onCambiarPagina={listado.setPagina}
        etiqueta="tipos"
      />

      {enEdicion && (
        <TipoDialog
          tipo={enEdicion}
          onCerrar={() => setEnEdicion(null)}
          onGuardado={() => {
            setEnEdicion(null);
            listado.refresh();
          }}
        />
      )}
    </div>
  );
}

function TipoDialog({ tipo, onCerrar, onGuardado }) {
  const esEdicion = Boolean(tipo.id);
  const [valores, setValores] = useState({
    nombre: tipo.nombre || "",
    codigo: tipo.codigo || "",
    descripcion: tipo.descripcion || "",
    categoria: tipo.categoria || "",
    activo: tipo.activo ?? true,
  });
  /* Solo las activas: clasificar en una categoría retirada es justo lo que
     desactivarla pretende evitar. La que ya tuviera el tipo se conserva
     igualmente, porque el servidor no la toca si no se envía. */
  const [categorias, setCategorias] = useState([]);

  useEffect(() => {
    categoriasActivoService
      .list({ activa: "true", page_size: 100 })
      .then((datos) => setCategorias(datos.results ?? datos))
      .catch(() => setCategorias([]));
  }, []);
  // Las características de un tipo que todavía no existe: no hay dónde
  // colgarlas hasta que el tipo se guarde, así que se acumulan aquí y viajan
  // con él en el mismo envío. El servidor crea las dos cosas en una
  // transacción, así que un tipo nunca queda creado y descrito a medias.
  const [caracteristicas, setCaracteristicas] = useState([]);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      if (esEdicion) {
        await tiposDispositivoService.update(tipo.id, valores);
      } else {
        await tiposDispositivoService.create(
          caracteristicas.length > 0
            ? { ...valores, caracteristicas }
            : valores,
        );
      }
      onGuardado();
    } catch (err) {
      setError(
        mensajeDeError(err, "No se pudo guardar el tipo de dispositivo."),
      );
      setIsSaving(false);
    }
  }

  return (
    <ModalDialog
      titulo={
        esEdicion ? "Editar tipo de dispositivo" : "Nuevo tipo de dispositivo"
      }
      onCerrar={onCerrar}
      onSubmit={handleSubmit}
      isSaving={isSaving}
    >
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <div className="mz-field-grid">
        <div className="mz-field">
          <label htmlFor="tipo-nombre">Nombre</label>
          <input
            id="tipo-nombre"
            className="form-control"
            required
            maxLength={120}
            placeholder="Laptop, Servidor, Impresora…"
            value={valores.nombre}
            onChange={(event) =>
              setValores({ ...valores, nombre: event.target.value })
            }
          />
        </div>

        <div className="mz-field">
          <label htmlFor="tipo-categoria">Categoría</label>
          <select
            id="tipo-categoria"
            className="form-select"
            value={valores.categoria || ""}
            onChange={(event) =>
              setValores({ ...valores, categoria: event.target.value })
            }
          >
            <option value="">Sin clasificar</option>
            {categorias.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.nombre}
              </option>
            ))}
          </select>
          <div className="form-text">
            De qué clase de bien se trata. Los equipos de este tipo la heredan.
          </div>
        </div>

        <div className="mz-field mz-field--full">
          <label htmlFor="tipo-codigo">Código</label>
          <input
            id="tipo-codigo"
            className="form-control text-uppercase mz-mono"
            required
            maxLength={10}
            pattern="[A-Za-z0-9]+"
            placeholder="LAP"
            value={valores.codigo}
            onChange={(event) =>
              setValores({ ...valores, codigo: event.target.value })
            }
          />
          <div className="form-text">
            Solo letras y dígitos: forma parte del código de barras de cada
            activo de este tipo (por ejemplo <code>GA-LAP-000001</code>).
            {esEdicion && " Cambiarlo no renumera los activos ya registrados."}
          </div>
        </div>

        <div className="mz-field mz-field--full">
          <label htmlFor="tipo-descripcion">Descripción</label>
          <textarea
            id="tipo-descripcion"
            className="form-control"
            rows={2}
            value={valores.descripcion}
            onChange={(event) =>
              setValores({ ...valores, descripcion: event.target.value })
            }
          />
        </div>
      </div>

      <div className="form-check mt-3">
        <input
          id="tipo-activo"
          type="checkbox"
          className="form-check-input"
          checked={valores.activo}
          onChange={(event) =>
            setValores({ ...valores, activo: event.target.checked })
          }
        />
        <label className="form-check-label" htmlFor="tipo-activo">
          Disponible para registrar activos nuevos
        </label>
      </div>

      {/* También al crear: un tipo que entra al catálogo sin declarar nada
          admite características libres en sus primeros equipos, y esa es
          justamente la dispersión que declararlas evita. Al dar de alta no hay
          identificador todavía, así que se acumulan aquí y se envían con el
          tipo. */}
      <div className="mz-section mt-4 mb-0">
        <h4>Características de este tipo</h4>
      </div>
      <CaracteristicasDelTipo
        tipo={esEdicion ? tipo : { nombre: valores.nombre }}
        puedeEditar
        borrador={caracteristicas}
        onBorradorChange={setCaracteristicas}
      />
    </ModalDialog>
  );
}
