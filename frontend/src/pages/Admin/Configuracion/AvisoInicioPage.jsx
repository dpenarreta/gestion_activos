import { useEffect, useRef, useState } from "react";

import { avisoInicioService } from "../../../api/avisoInicioService";
import { VentanaAviso } from "../../../components/admin/AvisoInicioSesion/AvisoInicioSesion";
import {
  Campo,
  enfocarPrimerError,
  LeyendaObligatorios,
} from "../../../components/common/Campo/Campo";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  hayErroresGenerales,
  erroresPorCampo,
  mensajeDeError,
} from "../../../utils/errores";
import { formatearFecha } from "../../../utils/formato";

/**
 * Configuración → Aviso al iniciar sesión: el aviso importante que ve toda
 * persona al entrar al sistema (una vez por sesión). Uno solo: título,
 * imagen opcional y contenido; se enciende o se apaga, y la vista previa lo
 * muestra exactamente como lo verán.
 */
export function AvisoInicioPage() {
  const [valores, setValores] = useState(null);
  const [imagen, setImagen] = useState(null);
  const [quitarImagen, setQuitarImagen] = useState(false);
  const [imagenActual, setImagenActual] = useState(null);
  const [imagenNueva, setImagenNueva] = useState(null);
  const [actualizado, setActualizado] = useState(null);
  const [vistaPrevia, setVistaPrevia] = useState(false);
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState({});
  const [guardado, setGuardado] = useState(false);
  const formRef = useRef(null);
  const [guardando, setGuardando] = useState(false);

  function cargarImagen(tiene) {
    if (!tiene) {
      setImagenActual(null);
      return;
    }
    avisoInicioService
      .imagen()
      .then((blob) => setImagenActual(URL.createObjectURL(blob)))
      .catch(() => setImagenActual(null));
  }

  useEffect(() => {
    avisoInicioService
      .obtener()
      .then((datos) => {
        setValores({
          activo: datos.activo,
          titulo: datos.titulo,
          contenido: datos.contenido,
        });
        setActualizado(datos.actualizado);
        cargarImagen(datos.tiene_imagen);
      })
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar el aviso.")),
      );
  }, []);

  useEffect(() => {
    if (!imagen) {
      setImagenNueva(null);
      return undefined;
    }
    const url = URL.createObjectURL(imagen);
    setImagenNueva(url);
    return () => URL.revokeObjectURL(url);
  }, [imagen]);

  function fijar(campo) {
    return (e) => {
      setGuardado(false);
      setErrores((actuales) =>
        actuales[campo] ? { ...actuales, [campo]: undefined } : actuales,
      );
      setValores((v) => ({
        ...v,
        [campo]:
          e.target.type === "checkbox" ? e.target.checked : e.target.value,
      }));
    };
  }

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    setErrores({});
    setGuardado(false);
    try {
      const datos = await avisoInicioService.guardar(
        { ...valores, quitar_imagen: quitarImagen },
        imagen,
      );
      setValores({
        activo: datos.activo,
        titulo: datos.titulo,
        contenido: datos.contenido,
      });
      setActualizado(datos.actualizado);
      setImagen(null);
      setQuitarImagen(false);
      cargarImagen(datos.tiene_imagen);
      setGuardado(true);
    } catch (err) {
      // Cada error bajo su campo (auditoría UX/UI, fase 2, 28/10/2026): «el
      // aviso encendido necesita título» se lee junto al título.
      const porCampo = erroresPorCampo(err);
      const claves = Object.keys(porCampo);
      setErrores(porCampo);
      setError(
        claves.length > 0 &&
          claves.every((clave) =>
            ["titulo", "contenido", "imagen"].includes(clave),
          ) &&
          !hayErroresGenerales(err)
          ? "Revise los campos marcados."
          : mensajeDeError(err, "No se pudo guardar el aviso."),
      );
      enfocarPrimerError(formRef.current);
    } finally {
      setGuardando(false);
    }
  }

  if (!valores) {
    return error ? (
      <div className="mz-alert mz-alert--bad" role="alert">
        <Icon name="x-octagon" />
        {error}
      </div>
    ) : null;
  }

  const imagenParaMostrar = quitarImagen ? null : imagenNueva || imagenActual;

  return (
    <div className="mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Aviso al iniciar sesión</h2>
          <p className="mz-desc">
            Una ventana destacada que ve toda persona al entrar al sistema, una
            vez por sesión. Si cambia el aviso, quien ya lo cerró lo vuelve a
            ver.
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <form ref={formRef} className="mz-card" onSubmit={guardar}>
        <div className="mz-card-body row g-3">
          <div className="col-12">
            <label className="form-check form-switch">
              <input
                type="checkbox"
                role="switch"
                className="form-check-input"
                checked={valores.activo}
                onChange={fijar("activo")}
              />{" "}
              <span className="form-check-label">
                <strong>
                  {valores.activo
                    ? "Encendido: se muestra al iniciar sesión"
                    : "Apagado: no se muestra"}
                </strong>
              </span>
            </label>
          </div>
          {/* El título es obligatorio con el aviso encendido: es lo que el
              servidor exige (auditoría UX/UI, fase 2, 28/10/2026). */}
          <Campo
            id="aviso-titulo"
            etiqueta="Título"
            obligatorio={valores.activo}
            error={errores.titulo}
            className="col-12"
          >
            <input
              className="form-control"
              maxLength={150}
              value={valores.titulo}
              onChange={fijar("titulo")}
            />
          </Campo>
          <Campo
            id="aviso-contenido"
            etiqueta="Contenido"
            ayuda="Se respetan los saltos de línea con que se escriba."
            error={errores.contenido}
            className="col-12"
          >
            <textarea
              className="form-control"
              rows={6}
              value={valores.contenido}
              onChange={fijar("contenido")}
            />
          </Campo>
          <div className="col-12 col-md-8">
            <Campo
              id="aviso-imagen"
              etiqueta="Imagen (opcional)"
              ayuda="JPG, PNG o WebP, hasta 5 MB. Se muestra arriba, a todo el ancho de la ventana: medida recomendada 1200 × 600 px."
              error={errores.imagen}
            >
              <input
                type="file"
                className="form-control"
                accept=".jpg,.jpeg,.png,.webp"
                onChange={(e) => {
                  setImagen(e.target.files?.[0] ?? null);
                  setQuitarImagen(false);
                  setGuardado(false);
                  setErrores((actuales) => ({
                    ...actuales,
                    imagen: undefined,
                  }));
                }}
              />
            </Campo>
            {imagenParaMostrar && (
              <div className="mt-2 d-flex align-items-start gap-2">
                <img
                  src={imagenParaMostrar}
                  alt="Imagen del aviso"
                  style={{ maxHeight: 120, maxWidth: "100%", borderRadius: 8 }}
                />
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  onClick={() => {
                    setImagen(null);
                    setQuitarImagen(true);
                    setGuardado(false);
                  }}
                >
                  <Icon name="trash" /> Quitar imagen
                </button>
              </div>
            )}
          </div>
          {/* El éxito, con el aviso del sistema y no con `text-success`
              (auditoría UX/UI, fase 2). */}
          {guardado && (
            <div className="col-12">
              <div className="mz-alert mz-alert--ok mb-0" role="status">
                <Icon name="check2-circle" />
                Guardado.
              </div>
            </div>
          )}
          <div className="col-12 mz-actions justify-content-end align-items-center">
            <div className="me-auto">
              {valores.activo && <LeyendaObligatorios />}
              {actualizado && (
                <span className="mz-small mz-faint">
                  Última modificación: {formatearFecha(actualizado, true)}
                </span>
              )}
            </div>
            <button
              type="button"
              className="btn btn-outline-secondary"
              disabled={!valores.titulo.trim()}
              onClick={() => setVistaPrevia(true)}
            >
              <Icon name="eye" /> Vista previa
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={guardando}
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </form>

      {vistaPrevia && (
        <VentanaAviso
          titulo={valores.titulo}
          contenido={valores.contenido}
          imagenUrl={imagenParaMostrar}
          onCerrar={() => setVistaPrevia(false)}
        />
      )}
    </div>
  );
}
