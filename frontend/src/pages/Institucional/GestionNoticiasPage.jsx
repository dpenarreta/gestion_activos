import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { institucionalService } from "../../api/institucionalService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { FilaDeEstado } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import { MEDIDAS_CARRUSEL, useImagenesDeNoticias } from "./CarruselNoticias";
import "./Institucional.css";
import { confirmar } from "../../components/common/Confirmar/confirmar";

const ESTADOS = {
  publicada: ["Publicada", "mz-pill--ok"],
  programada: ["Programada", "mz-pill--warn"],
  vencida: ["Vencida", "mz-pill--neutral"],
};

function hoyIso() {
  const ahora = new Date();
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/** Agregar o editar una imagen del carrusel, en una ventana. */
function FormularioNoticia({ inicial, onGuardar, onCerrar }) {
  const [valores, setValores] = useState(inicial);
  const [imagen, setImagen] = useState(null);
  const [vista, setVista] = useState(null);
  const [error, setError] = useState(null);
  // Errores junto a su campo y foco al primero (auditoría UX/UI, fase 2,
  // 28/10/2026).
  const [errores, setErrores] = useState({});
  const formulario = useRef(null);
  const [guardando, setGuardando] = useState(false);
  const editando = Boolean(inicial.id);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const fijar = (campo) => (e) =>
    setValores((v) => ({ ...v, [campo]: e.target.value }));

  useEffect(() => {
    if (!imagen) {
      setVista(null);
      return undefined;
    }
    const url = URL.createObjectURL(imagen);
    setVista(url);
    return () => URL.revokeObjectURL(url);
  }, [imagen]);

  async function enviar(evento) {
    evento.preventDefault();
    if (!editando && !imagen) {
      setError(null);
      setErrores({ imagen: "Adjunte la imagen." });
      enfocarPrimerError(formulario.current);
      return;
    }
    setGuardando(true);
    setError(null);
    setErrores({});
    try {
      const {
        titulo,
        descripcion,
        texto_alternativo,
        publicar_desde,
        publicar_hasta,
        orden,
      } = valores;
      await onGuardar(
        {
          titulo,
          descripcion,
          texto_alternativo: texto_alternativo ?? "",
          publicar_desde,
          publicar_hasta,
          orden,
        },
        imagen,
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la imagen."));
      setErrores(erroresPorCampo(err));
      setGuardando(false);
      enfocarPrimerError(formulario.current);
    }
  }

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal mz-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="noticia-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="noticia-titulo">
            {editando ? "Editar imagen del carrusel" : "Agregar imagen"}
          </h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <form
          ref={formulario}
          className="mz-panel-body row g-2"
          onSubmit={enviar}
          noValidate
        >
          {error && (
            <div className="col-12">
              <div className="mz-alert mz-alert--bad" role="alert">
                <Icon name="x-octagon" />
                {error}
              </div>
            </div>
          )}
          <div className="col-12">
            <LeyendaObligatorios />
          </div>
          <div className="col-12">
            <Campo
              id="noticia-imagen"
              etiqueta={editando ? "Reemplazar imagen (opcional)" : "Imagen"}
              obligatorio={!editando}
              ayuda={`JPG, PNG o WebP, hasta 5 MB. Medida: ${MEDIDAS_CARRUSEL.ancho} × ${MEDIDAS_CARRUSEL.alto} px (proporción ${MEDIDAS_CARRUSEL.proporcion}).`}
              error={errores.imagen}
            >
              <input
                type="file"
                className="form-control form-control-sm"
                accept=".jpg,.jpeg,.png,.webp"
                onChange={(e) => setImagen(e.target.files?.[0] ?? null)}
              />
            </Campo>
            {vista && (
              <img
                src={vista}
                alt="Vista previa"
                className="d-block mt-2 rounded"
                style={{ maxHeight: 140, maxWidth: "100%" }}
              />
            )}
          </div>
          <Campo
            id="noticia-titulo-campo"
            etiqueta="Título (opcional)"
            error={errores.titulo}
            className="col-12 col-md-8"
          >
            <input
              className="form-control form-control-sm"
              maxLength={150}
              value={valores.titulo}
              onChange={fijar("titulo")}
            />
          </Campo>
          <Campo
            id="noticia-orden"
            etiqueta="Orden"
            error={errores.orden}
            className="col-6 col-md-4"
          >
            <input
              type="number"
              min={0}
              className="form-control form-control-sm"
              value={valores.orden}
              onChange={fijar("orden")}
            />
          </Campo>
          <Campo
            id="noticia-descripcion"
            etiqueta="Descripción (opcional)"
            error={errores.descripcion}
            className="col-12"
          >
            <input
              className="form-control form-control-sm"
              maxLength={300}
              value={valores.descripcion}
              onChange={fijar("descripcion")}
            />
          </Campo>
          <Campo
            id="noticia-alt"
            etiqueta="Texto alternativo de la imagen (opcional)"
            ayuda="Escriba lo que dice la imagen (fechas, lugares, horarios) para quien no puede verla. Si la imagen solo decora y el título y la descripción ya lo dicen todo, déjelo vacío. Mejor aún: no deje datos importantes solo dentro de la imagen."
            error={errores.texto_alternativo}
            className="col-12"
          >
            <textarea
              className="form-control form-control-sm"
              rows={2}
              maxLength={300}
              value={valores.texto_alternativo ?? ""}
              onChange={fijar("texto_alternativo")}
            />
          </Campo>
          <Campo
            id="noticia-desde"
            etiqueta="Publicar desde"
            obligatorio
            error={errores.publicar_desde}
            className="col-6"
          >
            <input
              type="date"
              className="form-control form-control-sm"
              value={valores.publicar_desde}
              onChange={fijar("publicar_desde")}
            />
          </Campo>
          <Campo
            id="noticia-hasta"
            etiqueta="Publicar hasta"
            obligatorio
            error={errores.publicar_hasta}
            className="col-6"
          >
            <input
              type="date"
              min={valores.publicar_desde || undefined}
              className="form-control form-control-sm"
              value={valores.publicar_hasta}
              onChange={fijar("publicar_hasta")}
            />
          </Campo>
          <div className="col-12 mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onCerrar}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={guardando}
            >
              {guardando
                ? "Guardando…"
                : editando
                  ? "Guardar cambios"
                  : "Agregar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Cada cuántos segundos cambia solo el carrusel. */
function AjusteSegundos() {
  const [segundos, setSegundos] = useState("");
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    institucionalService
      .carrusel()
      .then((a) => setSegundos(String(a.segundos)))
      // Antes el campo quedaba vacío sin decir por qué (auditoría UX/UI,
      // fase 2, 28/10/2026).
      .catch((err) =>
        setError(
          mensajeDeError(
            err,
            "No se pudo cargar cada cuánto cambia la imagen.",
          ),
        ),
      );
  }, []);

  async function guardar(evento) {
    evento.preventDefault();
    setMensaje(null);
    setError(null);
    try {
      const a = await institucionalService.guardarCarrusel(Number(segundos));
      setSegundos(String(a.segundos));
      setMensaje("Guardado");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
    }
  }

  return (
    <form className="mz-card" onSubmit={guardar}>
      <div className="mz-card-body d-flex flex-wrap align-items-end gap-2">
        <div>
          <label className="form-label mz-small" htmlFor="carrusel-segundos">
            Cambiar de imagen cada (segundos)
          </label>
          <input
            id="carrusel-segundos"
            type="number"
            min={5}
            max={60}
            required
            className="form-control form-control-sm"
            style={{ width: 120 }}
            value={segundos}
            onChange={(e) => {
              setSegundos(e.target.value);
              setMensaje(null);
            }}
          />
        </div>
        <button type="submit" className="btn btn-outline-primary btn-sm">
          Guardar
        </button>
        {mensaje && (
          <span className="mz-small text-success" role="status">
            <Icon name="check-circle" /> {mensaje}
          </span>
        )}
        {error && (
          <span className="mz-small text-danger" role="alert">
            {error}
          </span>
        )}
        <span className="mz-faint mz-small ms-auto">
          Entre 5 y 60 segundos. Se detiene con el mouse o el foco encima, o con
          el botón «Pausar».
        </span>
      </div>
    </form>
  );
}

/**
 * Las medidas exactas de las imágenes, para que marketing las haga a la
 * medida: tamaño, proporción, formato, peso y la zona segura (lo que no tapan
 * las flechas, los puntos ni la franja del título).
 */
function MedidasDeLasImagenes() {
  const { ancho, alto, proporcion, minimoAncho, minimoAlto } = MEDIDAS_CARRUSEL;
  return (
    <section className="mz-card" aria-labelledby="medidas-titulo">
      <div className="mz-card-body">
        <h3 id="medidas-titulo" className="inicio-titulo">
          <Icon name="aspect-ratio" /> Medidas de las imágenes
        </h3>
        <div className="row g-4 align-items-center">
          <div className="col-12 col-lg-6">
            <dl className="row mb-0 mz-small">
              <dt className="col-5">Tamaño exacto</dt>
              <dd className="col-7">
                <strong>
                  {ancho} × {alto} px
                </strong>{" "}
                (ancho × alto)
              </dd>
              <dt className="col-5">Proporción</dt>
              <dd className="col-7">{proporcion} (horizontal)</dd>
              <dt className="col-5">Tamaño mínimo</dt>
              <dd className="col-7">
                {minimoAncho} × {minimoAlto} px; más pequeña se ve borrosa
              </dd>
              <dt className="col-5">Formato y peso</dt>
              <dd className="col-7">JPG, PNG o WebP, hasta 5 MB</dd>
              <dt className="col-5">Zona segura</dt>
              <dd className="col-7">
                Textos y logos dentro del recuadro verde: a{" "}
                {Math.round(ancho * 0.1)} px de los lados (ahí van las flechas)
                y a {Math.round(alto * 0.22)} px del borde de abajo (ahí van los
                puntos y, si la imagen tiene título, su franja).
              </dd>
            </dl>
            <p className="mz-faint mz-small mb-0">
              En Inicio el carrusel ocupa la mitad del ancho y se ve siempre en{" "}
              {proporcion}, junto al calendario: una imagen de esta medida se ve
              completa, sin recortes. Otra proporción se recorta para llenar el
              espacio.
            </p>
          </div>
          <div className="col-12 col-lg-6">
            <div
              className="medidas-guia"
              role="img"
              aria-label={`Guía de ${ancho} por ${alto} píxeles con la zona segura marcada`}
            >
              <span className="medidas-guia__cota medidas-guia__cota--ancho">
                {ancho} px
              </span>
              <span className="medidas-guia__cota medidas-guia__cota--alto">
                {alto} px
              </span>
              <div className="medidas-guia__segura">Zona segura</div>
              <div className="medidas-guia__franja">
                Puntos y título (evitar textos)
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Institucional → Inicio → «Gestionar noticias» (pide `noticias.gestionar`):
 * las imágenes del carrusel de Inicio, cada una con su día de inicio y de
 * fin, y cada cuántos segundos cambia.
 */
export function GestionNoticiasPage() {
  const [noticias, setNoticias] = useState(null);
  const [error, setError] = useState(null);
  // El fallo al cargar va en la tabla, con «Reintentar» (auditoría UX/UI,
  // fase 2, 28/10/2026).
  const [errorCarga, setErrorCarga] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [editando, setEditando] = useState(null);
  const { urls: miniaturas } = useImagenesDeNoticias(noticias ?? []);

  const cargar = useCallback(() => {
    setErrorCarga(null);
    return institucionalService
      .noticias(true)
      .then(setNoticias)
      .catch((err) =>
        setErrorCarga(
          mensajeDeError(err, "No se pudieron cargar las noticias."),
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar(campos, imagen) {
    await institucionalService.guardarNoticia(editando.id, campos, imagen);
    setAviso(editando.id ? "Imagen actualizada." : "Imagen agregada.");
    setEditando(null);
    await cargar();
  }

  async function borrar(noticia) {
    if (
      !(await confirmar({
        titulo: `¿Borrar «${noticia.titulo || noticia.nombre_original}» del carrusel?`,
        accion: "Borrar",
      }))
    )
      return;
    setError(null);
    setAviso(null);
    try {
      await institucionalService.eliminarNoticia(noticia.id);
      setAviso("Imagen borrada.");
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo borrar la imagen."));
    }
  }

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Gestionar noticias</h2>
          <p className="mz-desc">
            Las imágenes del carrusel de Inicio: noticias, avisos y eventos.
            Cada una se muestra solo entre sus fechas de publicación.
          </p>
        </div>
        <div className="mz-actions">
          <Link
            to="/admin/institucional/inicio"
            className="btn btn-outline-secondary btn-sm"
          >
            <Icon name="arrow-left" /> Volver al inicio
          </Link>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() =>
              setEditando({
                titulo: "",
                descripcion: "",
                texto_alternativo: "",
                publicar_desde: hoyIso(),
                publicar_hasta: hoyIso(),
                orden: 0,
              })
            }
          >
            <Icon name="plus-lg" /> Agregar imagen
          </button>
        </div>
      </div>

      <AjusteSegundos />
      <MedidasDeLasImagenes />

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check-circle" />
          {aviso}
        </div>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Imagen</th>
              <th>Título</th>
              <th>Publicada desde</th>
              <th>Hasta</th>
              <th>Estado</th>
              <th className="num">Orden</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {(noticias ?? []).map((n) => {
              const [texto, clase] = ESTADOS[n.estado] ?? ESTADOS.vencida;
              return (
                <tr key={n.id}>
                  <td>
                    {miniaturas[n.id] ? (
                      <img
                        src={miniaturas[n.id]}
                        alt=""
                        className="noticias-miniatura"
                      />
                    ) : (
                      <span className="noticias-miniatura d-inline-block" />
                    )}
                  </td>
                  <td>
                    {n.titulo || (
                      <span className="mz-faint">{n.nombre_original}</span>
                    )}
                    {n.descripcion && (
                      <span className="d-block mz-small mz-faint">
                        {n.descripcion}
                      </span>
                    )}
                  </td>
                  <td>{formatearFecha(n.publicar_desde)}</td>
                  <td>{formatearFecha(n.publicar_hasta)}</td>
                  <td>
                    <span className={`mz-pill ${clase}`}>{texto}</span>
                  </td>
                  <td className="num">{n.orden}</td>
                  <td className="num text-nowrap">
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      aria-label={`Editar ${n.titulo || n.nombre_original}`}
                      onClick={() =>
                        setEditando({
                          id: n.id,
                          titulo: n.titulo,
                          descripcion: n.descripcion,
                          texto_alternativo: n.texto_alternativo ?? "",
                          publicar_desde: n.publicar_desde,
                          publicar_hasta: n.publicar_hasta,
                          orden: n.orden,
                        })
                      }
                    >
                      <Icon name="pencil" />
                    </button>{" "}
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      aria-label={`Borrar ${n.titulo || n.nombre_original}`}
                      onClick={() => borrar(n)}
                    >
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              );
            })}
            <FilaDeEstado
              columnas={7}
              cargando={noticias === null}
              error={errorCarga}
              onReintentar={cargar}
              vacio={noticias?.length === 0}
              textoVacio="Todavía no hay imágenes en el carrusel."
            />
          </tbody>
        </table>
      </div>

      {editando && (
        <FormularioNoticia
          inicial={editando}
          onGuardar={guardar}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}
