import { useCallback, useEffect, useMemo, useState } from "react";

import { catalogoMatrizService } from "../../api/matrizService";
import { ConfirmDialog } from "../../components/common/ConfirmDialog/ConfirmDialog";
import { Icon } from "../../components/common/Icon/Icon";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import { usePermission } from "../../hooks/usePermission";
import { mensajeDeError } from "../../utils/errores";

const TEXTOS = {
  areas: {
    titulo: "Temas",
    singular: "tema",
    descripcion:
      "El tema de cada obligación (Ambiental, Seguros y Pólizas…). No son las áreas del organigrama: se comparten entre todas las empresas, así los reportes de cumplimiento suman el grupo entero.",
    ejemploCodigo: "CONT",
    ejemploNombre: "Contabilidad y Tributario",
  },
  "entidades-control": {
    titulo: "Entidades de control",
    singular: "entidad de control",
    descripcion:
      "Quién exige cada obligación: SRI, IESS, el municipio… Compartidas por todas las empresas.",
    ejemploCodigo: "SRI",
    ejemploNombre: "Servicio de Rentas Internas (SRI)",
  },
};

/**
 * Temas o entidades de control de la Matriz (Configuración → Catálogos).
 *
 * Una sola pantalla para los dos: son el mismo catálogo —código y nombre—
 * con otro uso. Se pueden eliminar, salvo que una obligación los use: el
 * servidor responde 409 y aquí se dice por qué.
 */
export function CatalogoMatrizPage({ tipo }) {
  const textos = TEXTOS[tipo];
  const servicio = useMemo(() => catalogoMatrizService(tipo), [tipo]);
  const puedeEditar = usePermission("catalogos.editar");
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [editando, setEditando] = useState(null);
  const [errorForm, setErrorForm] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [aBorrar, setABorrar] = useState(null);
  const [isBorrando, setIsBorrando] = useState(false);

  const cargar = useCallback(() => {
    servicio
      .list()
      .then((datos) => {
        setFilas(datos);
        setError(null);
      })
      .catch((err) =>
        setError(
          mensajeDeError(
            err,
            `No se pudo cargar ${textos.titulo.toLowerCase()}.`,
          ),
        ),
      );
  }, [servicio, textos]);

  useEffect(() => {
    setFilas(null);
    cargar();
  }, [cargar]);

  async function guardar(evento) {
    evento.preventDefault();
    setIsSaving(true);
    setErrorForm(null);
    try {
      const datos = { codigo: editando.codigo, nombre: editando.nombre };
      if (editando.id) await servicio.update(editando.id, datos);
      else await servicio.create(datos);
      setEditando(null);
      cargar();
    } catch (err) {
      setErrorForm(mensajeDeError(err, "No se pudo guardar."));
    } finally {
      setIsSaving(false);
    }
  }

  async function borrar() {
    setIsBorrando(true);
    try {
      await servicio.remove(aBorrar.id);
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo eliminar."));
    } finally {
      setIsBorrando(false);
      setABorrar(null);
    }
  }

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>{textos.titulo}</h2>
          <p className="mz-desc">{textos.descripcion}</p>
        </div>
        {puedeEditar && (
          <div className="mz-view-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setErrorForm(null);
                setEditando({ codigo: "", nombre: "" });
              }}
            >
              <Icon name="plus-lg" /> Nueva {textos.singular}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              {puedeEditar && <th aria-label="Acciones" />}
            </tr>
          </thead>
          <tbody>
            {filas === null && !error && (
              <tr className="mz-empty-row">
                <td colSpan={3}>Cargando…</td>
              </tr>
            )}
            {filas?.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={3}>Sin registros todavía.</td>
              </tr>
            )}
            {filas?.map((fila) => (
              <tr key={fila.id}>
                <td className="mz-code">{fila.codigo}</td>
                <td className="mz-strong">{fila.nombre}</td>
                {puedeEditar && (
                  <td className="acciones">
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      onClick={() => {
                        setErrorForm(null);
                        setEditando({ ...fila });
                      }}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      onClick={() => setABorrar(fila)}
                      aria-label={`Eliminar ${fila.nombre}`}
                    >
                      <Icon name="trash" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <ModalDialog
          titulo={
            editando.id
              ? `Editar ${textos.singular}`
              : `Nueva ${textos.singular}`
          }
          onCerrar={() => setEditando(null)}
          onSubmit={guardar}
          textoConfirmar="Guardar"
          isSaving={isSaving}
        >
          {errorForm && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {errorForm}
            </div>
          )}
          <div className="mz-field-grid">
            <div className="mz-field">
              <label htmlFor="catalogo-codigo">Código</label>
              <input
                id="catalogo-codigo"
                className="form-control"
                required
                maxLength={10}
                placeholder={textos.ejemploCodigo}
                value={editando.codigo}
                onChange={(e) =>
                  setEditando({ ...editando, codigo: e.target.value })
                }
              />
            </div>
            <div className="mz-field mz-field--full">
              <label htmlFor="catalogo-nombre">Nombre</label>
              <input
                id="catalogo-nombre"
                className="form-control"
                required
                maxLength={160}
                placeholder={textos.ejemploNombre}
                value={editando.nombre}
                onChange={(e) =>
                  setEditando({ ...editando, nombre: e.target.value })
                }
              />
            </div>
          </div>
        </ModalDialog>
      )}

      <ConfirmDialog
        isOpen={Boolean(aBorrar)}
        title={`Eliminar ${textos.singular}`}
        message={
          aBorrar
            ? `Se eliminará «${aBorrar.nombre}». Si alguna obligación la usa, no se podrá eliminar.`
            : ""
        }
        confirmLabel="Eliminar"
        confirmVariant="danger"
        isLoading={isBorrando}
        onConfirm={borrar}
        onCancel={() => setABorrar(null)}
      />
    </div>
  );
}
