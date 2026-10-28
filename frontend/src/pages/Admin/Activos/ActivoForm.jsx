import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  activosService,
  caracteristicasService,
  tiposDispositivoService,
} from "../../../api/activosService";
import {
  departamentosService,
  empleadosService,
  concesionariosService,
  proveedoresService,
  sedesService,
} from "../../../api/organizacionService";
import { EspecificacionesDelTipo } from "../../../components/activos/EspecificacionesDelTipo/EspecificacionesDelTipo";
import { EspecificacionesEditor } from "../../../components/activos/EspecificacionesEditor/EspecificacionesEditor";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  hayErroresGenerales,
  erroresPorCampo,
  mensajeDeError,
} from "../../../utils/errores";
import "./Activos.css";
import "./ActivoForm.css";

const VACIO = {
  tipo: "",
  nombre: "",
  marca: "",
  modelo: "",
  numero_serie: "",
  especificaciones: {},
  observaciones: "",
  responsables: [],
  compartido: false,
  solicitado_por: "",
  departamento: "",
  sede: "",
  criticidad: "media",
  uso: "administrativo",
  fecha_adquisicion: "",
  fecha_ingreso: "",
  costo_adquisicion: "",
  condicion: "",
  propiedad: "propia",
  concesionario: "",
  proveedor: "",
  fecha_fin_garantia: "",
};

/** Anota (o borra, con null) el fallo al cargar el catálogo de un campo. */
function conFallo(campo, mensaje) {
  return (actuales) => ({ ...actuales, [campo]: mensaje });
}

/** Los campos que el formulario muestra, para saber qué error va bajo cuál. */
const CAMPOS = [...Object.keys(VACIO)];

export function ActivoForm() {
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const navigate = useNavigate();

  const [valores, setValores] = useState(VACIO);
  const [tipos, setTipos] = useState([]);
  // Lo que el tipo elegido declara. Se recarga al cambiar de tipo porque el
  // formulario tiene que ofrecer lo de ese tipo, no lo del anterior.
  const [caracteristicas, setCaracteristicas] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [sedes, setSedes] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [concesionarios, setConcesionarios] = useState([]);
  const [error, setError] = useState(null);
  // Auditoría UX/UI, fase 2 (28/10/2026): el error del servidor va bajo el
  // campo que lo causó (una serie duplicada, bajo la serie) y no solo arriba;
  // y un catálogo que no carga lo dice junto a su lista, en vez de dejarla
  // vacía como si no hubiera nada que elegir.
  const [errores, setErrores] = useState({});
  const [fallosCatalogo, setFallosCatalogo] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const contenedorRef = useRef(null);

  /** El error que se muestra bajo un campo: el del servidor o el de su catálogo. */
  function errorDe(campo) {
    return errores[campo] || fallosCatalogo[campo];
  }

  // Las características del tipo elegido. Se piden al backend y no se deducen
  // de lo ya guardado: un equipo puede no tener todavía ninguna, y aun así el
  // formulario debe pedir las que su tipo declara.
  useEffect(() => {
    if (!valores.tipo) {
      setCaracteristicas([]);
      return;
    }
    caracteristicasService
      .delTipo(valores.tipo)
      .then((datos) => {
        setCaracteristicas(datos);
        setFallosCatalogo(conFallo("especificaciones", null));
      })
      .catch(() => {
        setCaracteristicas([]);
        setFallosCatalogo(
          conFallo(
            "especificaciones",
            "No se pudieron cargar las características de este tipo.",
          ),
        );
      });
  }, [valores.tipo]);

  useEffect(() => {
    tiposDispositivoService
      .list({ page_size: 100 })
      .then((datos) =>
        setTipos((datos.results ?? datos).filter((tipo) => tipo.activo)),
      )
      .catch(() => {
        setTipos([]);
        setFallosCatalogo(
          conFallo("tipo", "No se pudieron cargar los tipos de dispositivo."),
        );
      });
    departamentosService
      .list({ activo: "true", page_size: 100 })
      .then((datos) => setDepartamentos(datos.results ?? datos))
      .catch(() => {
        setDepartamentos([]);
        setFallosCatalogo(
          conFallo("departamento", "No se pudieron cargar los departamentos."),
        );
      });
    // Sin filtrar por «activo»: esa marca no la mantiene ninguna integración,
    // y el campo de quién pidió el equipo tiene que poder nombrar a cualquiera.
    // El custodio sí se acota, más abajo, porque entregar un equipo a alguien
    // que ya se fue sí es un error que conviene atajar.
    empleadosService
      .list({ page_size: 300 })
      .then((datos) => setEmpleados(datos.results ?? datos))
      .catch(() => {
        setEmpleados([]);
        setFallosCatalogo(
          conFallo("responsables", "No se pudieron cargar los empleados."),
        );
        setFallosCatalogo(
          conFallo("solicitado_por", "No se pudieron cargar los empleados."),
        );
      });
    // Solo sedes abiertas: dejar un equipo en una sede cerrada lo deja
    // registrado en un sitio donde nadie va a buscarlo.
    // Solo proveedores activos: uno dado de baja ya no vende ni atiende un
    // reclamo, así que registrarle una compra nueva no significa nada.
    proveedoresService
      .list({ activo: "true", page_size: 200 })
      .then((datos) => setProveedores(datos.results ?? datos))
      .catch(() => {
        setProveedores([]);
        setFallosCatalogo(
          conFallo("proveedor", "No se pudieron cargar los proveedores."),
        );
      });
    concesionariosService
      .list({ activo: "true", page_size: 200 })
      .then((datos) => setConcesionarios(datos.results ?? datos))
      .catch(() => {
        setConcesionarios([]);
        setFallosCatalogo(
          conFallo(
            "concesionario",
            "No se pudieron cargar los concesionarios.",
          ),
        );
      });
    sedesService
      .list({ activa: "true", page_size: 100 })
      .then((datos) => setSedes(datos.results ?? datos))
      .catch(() => {
        setSedes([]);
        setFallosCatalogo(conFallo("sede", "No se pudieron cargar las sedes."));
      });
  }, []);

  useEffect(() => {
    if (!esEdicion) return;
    activosService
      .get(id)
      .then((datos) =>
        setValores({
          tipo: datos.tipo,
          nombre: datos.nombre,
          marca: datos.marca,
          modelo: datos.modelo,
          numero_serie: datos.numero_serie,
          especificaciones: datos.especificaciones || {},
          observaciones: datos.observaciones || "",
          responsables: (datos.responsables || []).map((p) => String(p.id)),
          compartido: Boolean(datos.compartido),
          solicitado_por: datos.solicitado_por || "",
          departamento: datos.departamento,
          sede: datos.sede || "",
          criticidad: datos.criticidad || "media",
          uso: datos.uso || "administrativo",
          fecha_ingreso: datos.fecha_ingreso || "",
          fecha_adquisicion: datos.fecha_adquisicion,
          costo_adquisicion: datos.costo_adquisicion || "",
          condicion: datos.condicion || "",
          propiedad: datos.propiedad || "propia",
          concesionario: datos.concesionario || "",
          proveedor: datos.proveedor || "",
          fecha_fin_garantia: datos.fecha_fin_garantia || "",
        }),
      )
      .catch(() => setError("No se pudo cargar el activo."));
  }, [id, esEdicion]);

  function actualizar(campo, valor) {
    setValores((actuales) => ({ ...actuales, [campo]: valor }));
    // Al corregir el campo, su error del servidor deja de valer.
    setErrores((actuales) => {
      if (!actuales[campo]) return actuales;
      const resto = { ...actuales };
      delete resto[campo];
      return resto;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setErrores({});
    try {
      const payload = {
        tipo: valores.tipo,
        nombre: valores.nombre,
        marca: valores.marca,
        modelo: valores.modelo,
        numero_serie: valores.numero_serie,
        especificaciones: valores.especificaciones,
        observaciones: valores.observaciones,
        sede: valores.sede || null,
        criticidad: valores.criticidad,
        uso: valores.uso,
        fecha_adquisicion: valores.fecha_adquisicion,
        fecha_ingreso: valores.fecha_ingreso || null,
        costo_adquisicion: valores.costo_adquisicion || null,
        condicion: valores.condicion,
        propiedad: valores.propiedad,
        // Se manda null y no el resto del campo oculto: al volver el
        // equipo a ser de la empresa, dejar puesto al partner lo seguiría
        // contando como ajeno en cada reporte.
        concesionario:
          valores.propiedad === "concesion"
            ? valores.concesionario || null
            : null,
        proveedor: valores.proveedor || null,
        fecha_fin_garantia: valores.fecha_fin_garantia || null,
        compartido: valores.compartido,
      };

      if (esEdicion) {
        // Quién responde y el departamento no se envían al editar: cambiarlos
        // exige la acción de asignación, que deja el movimiento en el
        // historial. El backend los ignora aquí de todos modos.
        await activosService.update(id, payload);
        navigate(`/admin/activos/${id}`);
      } else {
        const creado = await activosService.create({
          ...payload,
          responsables: valores.responsables.map(Number),
          departamento: valores.departamento,
          // Vacío es lo normal: una compra de reposición no la pide nadie en
          // particular, y entonces el alta no avisa a nadie.
          solicitado_por: valores.solicitado_por || null,
        });
        navigate(`/admin/activos/${creado.id}`);
      }
    } catch (err) {
      const porCampo = erroresPorCampo(err);
      setErrores(porCampo);
      // Si todo lo que dijo el servidor quedó bajo algún campo, arriba basta
      // con decir que se revisen; si no, el aviso lleva el motivo completo.
      const todoEnSuCampo =
        Object.keys(porCampo).length > 0 &&
        Object.keys(porCampo).every((campo) => CAMPOS.includes(campo)) &&
        !hayErroresGenerales(err);
      setError(
        todoEnSuCampo
          ? "No se pudo guardar el activo: revise los campos marcados."
          : mensajeDeError(err, "No se pudo guardar el activo."),
      );
      enfocarPrimerError(contenedorRef.current);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="activo-form" ref={contenedorRef}>
      <div className="mz-view-head">
        <div>
          <h2>{esEdicion ? "Editar ficha técnica" : "Nuevo activo"}</h2>
          {!esEdicion && (
            <p className="mz-desc">
              El código de barras se genera automáticamente al guardar, a partir
              del tipo de dispositivo.
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <section className="mz-card">
        <div className="mz-card-head">
          <h3>Ficha del equipo</h3>
          <LeyendaObligatorios />
        </div>
        <form onSubmit={handleSubmit} className="mz-card-body">
          <section className="mz-section">
            <h4>Identificación</h4>
            <div className="row g-3">
              <Campo
                id="tipo"
                etiqueta="Tipo de dispositivo"
                obligatorio
                error={errorDe("tipo")}
                className="col-md-4"
              >
                <select
                  className="form-select"
                  value={valores.tipo}
                  onChange={(event) => actualizar("tipo", event.target.value)}
                >
                  <option value="">Seleccione un tipo</option>
                  {tipos.map((tipo) => (
                    <option key={tipo.id} value={tipo.id}>
                      {tipo.nombre} ({tipo.codigo})
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo
                id="nombre"
                etiqueta="Nombre del activo"
                obligatorio
                ayuda="Se imprime en la etiqueta, junto al código de barras."
                error={errorDe("nombre")}
                className="col-md-8"
              >
                <input
                  className="form-control"
                  maxLength={150}
                  placeholder="Laptop Contabilidad 01"
                  value={valores.nombre}
                  onChange={(event) => actualizar("nombre", event.target.value)}
                />
              </Campo>
              <Campo
                id="marca"
                etiqueta="Marca"
                obligatorio
                error={errorDe("marca")}
                className="col-md-4"
              >
                <input
                  className="form-control"
                  maxLength={80}
                  value={valores.marca}
                  onChange={(event) => actualizar("marca", event.target.value)}
                />
              </Campo>
              <Campo
                id="modelo"
                etiqueta="Modelo"
                obligatorio
                error={errorDe("modelo")}
                className="col-md-4"
              >
                <input
                  className="form-control"
                  maxLength={120}
                  value={valores.modelo}
                  onChange={(event) => actualizar("modelo", event.target.value)}
                />
              </Campo>
              <Campo
                id="numero_serie"
                etiqueta="Número de serie"
                obligatorio
                ayuda="Único en todo el inventario."
                error={errorDe("numero_serie")}
                className="col-md-4"
              >
                <input
                  className="form-control mz-mono"
                  maxLength={120}
                  value={valores.numero_serie}
                  onChange={(event) =>
                    actualizar("numero_serie", event.target.value)
                  }
                />
              </Campo>
            </div>
          </section>

          <section className="mz-section">
            <h4>
              {caracteristicas.length > 0
                ? "Características del equipo"
                : "Especificaciones del hardware"}
            </h4>
            {errorDe("especificaciones") && (
              <div className="mz-field-error mb-2">
                {errorDe("especificaciones")}
              </div>
            )}
            {/* Con características declaradas se piden esas y no otras; sin
              ellas, el tipo todavía no se describió y siguen valiendo los pares
              libres de antes. */}
            {caracteristicas.length > 0 ? (
              <EspecificacionesDelTipo
                caracteristicas={caracteristicas}
                valor={valores.especificaciones}
                heredadas={Object.entries(
                  valores.especificaciones || {},
                ).filter(
                  ([nombre]) =>
                    !caracteristicas.some((c) => c.nombre === nombre),
                )}
                onChange={(especificaciones) =>
                  actualizar("especificaciones", especificaciones)
                }
              />
            ) : (
              <EspecificacionesEditor
                valor={valores.especificaciones}
                onChange={(especificaciones) =>
                  actualizar("especificaciones", especificaciones)
                }
              />
            )}
          </section>

          <section className="mz-section">
            <h4>Custodia y ubicación</h4>
            <div className="row g-3">
              <Campo
                id="departamento"
                etiqueta="Departamento"
                obligatorio={!esEdicion}
                error={errorDe("departamento")}
                className="col-md-6"
              >
                <select
                  className="form-select"
                  disabled={esEdicion}
                  aria-describedby={esEdicion ? "custodia-ayuda" : undefined}
                  value={valores.departamento}
                  onChange={(event) =>
                    actualizar("departamento", event.target.value)
                  }
                >
                  <option value="">Seleccione un departamento</option>
                  {departamentos.map((departamento) => (
                    <option key={departamento.id} value={departamento.id}>
                      {departamento.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
              {/* El alta entrega a una sola persona incluso en un equipo
                compartido: sumar al resto del turno es una entrega más, y
                cada una deja su movimiento y su acta. Se hace desde la ficha,
                con «Asignar / trasladar». */}
              <Campo
                id="custodio"
                etiqueta="Custodio"
                ayuda={
                  valores.compartido
                    ? "A los demás se los suma desde la ficha, con «Asignar / trasladar»: cada entrega deja su acta."
                    : undefined
                }
                error={errorDe("responsables")}
                className="col-md-6"
              >
                <select
                  className="form-select"
                  disabled={esEdicion}
                  aria-describedby={esEdicion ? "custodia-ayuda" : undefined}
                  value={valores.responsables[0] || ""}
                  onChange={(event) =>
                    actualizar(
                      "responsables",
                      event.target.value ? [event.target.value] : [],
                    )
                  }
                >
                  <option value="">Sin asignar (queda en bodega)</option>
                  {empleados
                    .filter((empleado) => empleado.activo !== false)
                    .map((empleado) => (
                      <option key={empleado.id} value={empleado.id}>
                        {empleado.nombre_completo}
                      </option>
                    ))}
                </select>
              </Campo>
              {/* Un correo por cada equipo que entra al inventario es ruido,
                y del que se aprende a ignorar. */}
              <Campo
                id="solicitado_por"
                etiqueta="Lo pidió"
                ayuda={
                  valores.solicitado_por
                    ? "Se le avisará por correo de que el equipo ya llegó."
                    : "Si alguien lo pidió, anótelo y se le avisará al registrarlo."
                }
                error={errorDe("solicitado_por")}
                className="col-md-6"
              >
                <select
                  className="form-select"
                  disabled={esEdicion}
                  value={valores.solicitado_por}
                  onChange={(event) =>
                    actualizar("solicitado_por", event.target.value)
                  }
                >
                  <option value="">Nadie: es una compra de reposición</option>
                  {/* Todos, incluidos los marcados como inactivos: esa marca no
                    la mantiene nada, y lo que importa aquí es dejar constancia
                    de quién pidió el equipo. */}
                  {empleados.map((empleado) => (
                    <option key={empleado.id} value={empleado.id}>
                      {empleado.nombre_completo}
                    </option>
                  ))}
                </select>
              </Campo>
              <div className="col-12">
                <div className="form-check">
                  <input
                    id="compartido"
                    type="checkbox"
                    className="form-check-input"
                    aria-describedby="compartido-ayuda"
                    checked={valores.compartido}
                    onChange={(event) =>
                      actualizar("compartido", event.target.checked)
                    }
                  />
                  <label className="form-check-label" htmlFor="compartido">
                    Varias personas responden por él
                  </label>
                </div>
                <div id="compartido-ayuda" className="form-text">
                  {/* Repartir la responsabilidad de una laptop personal entre
                    tres nombres es lo que hace que después nadie responda por
                    ella: la marca es una decisión, no un efecto lateral. */}
                  Solo para equipos de turno, como un escáner de andén o una
                  impresora de mostrador.
                </div>
              </div>
              {esEdicion && (
                <div className="col-12">
                  <div id="custodia-ayuda" className="form-text">
                    Quién responde y el departamento se cambian desde la ficha,
                    con la acción «Asignar / trasladar»: así el cambio queda
                    registrado en el historial.
                  </div>
                </div>
              )}
              {/* El catálogo es lo que hace que el filtro por sede devuelva
                todos los equipos que están ahí y no solo los que alguien
                escribió igual. */}
              <Campo
                id="sede"
                etiqueta="Sede"
                ayuda="Se administra en Organización → Sedes."
                error={errorDe("sede")}
                className="col-md-6"
              >
                <select
                  className="form-select"
                  value={valores.sede}
                  onChange={(event) => actualizar("sede", event.target.value)}
                >
                  <option value="">Sin sede registrada</option>
                  {sedes.map((sede) => (
                    <option key={sede.id} value={sede.id}>
                      {sede.nombre}
                      {sede.ciudad ? ` — ${sede.ciudad}` : ""}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo
                id="criticidad"
                etiqueta="Criticidad"
                ayuda="Qué tan urgente es reponerlo si falla."
                error={errorDe("criticidad")}
                className="col-md-3"
              >
                <select
                  className="form-select"
                  value={valores.criticidad}
                  onChange={(event) =>
                    actualizar("criticidad", event.target.value)
                  }
                >
                  <option value="baja">Baja</option>
                  <option value="media">Media</option>
                  <option value="alta">Alta</option>
                  <option value="critica">Crítica</option>
                </select>
              </Campo>
              <Campo
                id="uso"
                etiqueta="Uso"
                ayuda="La función que cumple, no cuánto se usa."
                error={errorDe("uso")}
                className="col-md-3"
              >
                <select
                  className="form-select"
                  value={valores.uso}
                  onChange={(event) => actualizar("uso", event.target.value)}
                >
                  <option value="administrativo">Administrativo</option>
                  <option value="operativo">Operativo</option>
                  <option value="desarrollo">Desarrollo</option>
                  <option value="diseno">Diseño</option>
                  <option value="gerencial">Gerencial</option>
                  <option value="atencion_cliente">Atención al cliente</option>
                  <option value="bodega">Bodega</option>
                  <option value="infraestructura">Infraestructura</option>
                </select>
              </Campo>
            </div>
          </section>

          <section className="mz-section">
            <h4>Adquisición</h4>
            <div className="row g-3">
              <Campo
                id="fecha_adquisicion"
                etiqueta="Fecha de adquisición"
                obligatorio
                ayuda="Base del cálculo de vida útil del equipo."
                error={errorDe("fecha_adquisicion")}
                className="col-md-4"
              >
                <input
                  type="date"
                  className="form-control"
                  value={valores.fecha_adquisicion}
                  onChange={(event) =>
                    actualizar("fecha_adquisicion", event.target.value)
                  }
                />
              </Campo>
              {/* La garantía corre desde la compra y la custodia desde el
                ingreso: un equipo comprado en diciembre puede entrar en
                marzo. */}
              <Campo
                id="fecha_ingreso"
                etiqueta="Fecha de ingreso"
                ayuda="Cuándo entró al inventario, si es distinta de la compra."
                error={errorDe("fecha_ingreso")}
                className="col-md-4"
              >
                <input
                  type="date"
                  className="form-control"
                  value={valores.fecha_ingreso}
                  onChange={(event) =>
                    actualizar("fecha_ingreso", event.target.value)
                  }
                />
              </Campo>
              <Campo
                id="costo_adquisicion"
                etiqueta="Costo de compra"
                error={errorDe("costo_adquisicion")}
                className="col-md-4"
              >
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="form-control"
                  value={valores.costo_adquisicion}
                  onChange={(event) =>
                    actualizar("costo_adquisicion", event.target.value)
                  }
                />
              </Campo>
              {/* Un equipo usado llega con parte de su vida ya gastada: sus
                mismos meses de antigüedad no significan lo mismo. */}
              <Campo
                id="condicion"
                etiqueta="Condición al adquirirlo"
                ayuda="Si se compró nuevo o se adquirió de segunda mano."
                error={errorDe("condicion")}
                className="col-md-4"
              >
                <select
                  className="form-select"
                  value={valores.condicion}
                  onChange={(event) =>
                    actualizar("condicion", event.target.value)
                  }
                >
                  {/* Se puede dejar sin decir, y esa es la opción que viene por
                    delante: el levantamiento inicial se hace con equipos cuya
                    procedencia ya nadie recuerda, y dar «nuevo» por supuesto
                    sería inventarla. */}
                  <option value="">Sin especificar</option>
                  <option value="nuevo">Nuevo</option>
                  <option value="usado">Usado</option>
                </select>
              </Campo>
              {/* Escrito a mano, «Tecnomega» y «TECNOMEGA» serían dos
                proveedores y las compras quedarían repartidas. */}
              <Campo
                id="proveedor"
                etiqueta="Proveedor"
                ayuda="Se administra en Organización → Proveedores."
                error={errorDe("proveedor")}
                className="col-md-4"
              >
                <select
                  className="form-select"
                  value={valores.proveedor}
                  onChange={(event) =>
                    actualizar("proveedor", event.target.value)
                  }
                >
                  <option value="">Sin proveedor registrado</option>
                  {proveedores.map((proveedor) => (
                    <option key={proveedor.id} value={proveedor.id}>
                      {proveedor.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
              {/* No es lo mismo que tener proveedor: al proveedor se le
                compró, y entonces el equipo sí es de la empresa. */}
              <Campo
                id="propiedad"
                etiqueta="De quién es el equipo"
                ayuda="En concesión: lo compró un partner y lo mantenemos nosotros."
                error={errorDe("propiedad")}
                className="col-md-4"
              >
                <select
                  className="form-select"
                  value={valores.propiedad}
                  onChange={(event) =>
                    actualizar("propiedad", event.target.value)
                  }
                >
                  {/* Lo normal es que se haya comprado, así que es lo que viene
                    puesto: obligar a decirlo en cada alta no capturaría nada
                    que no se supiera ya. */}
                  <option value="propia">De la empresa</option>
                  <option value="concesion">En concesión</option>
                </select>
              </Campo>
              {/* Sin el dueño, «en concesión» no responde ni a qué hay que
                devolver ni a quién. */}
              {valores.propiedad === "concesion" && (
                <Campo
                  id="concesionario"
                  etiqueta="Concesionario"
                  obligatorio
                  ayuda="Se administra en Organización → Concesionarios."
                  error={errorDe("concesionario")}
                  className="col-md-4"
                >
                  <select
                    className="form-select"
                    value={valores.concesionario}
                    onChange={(event) =>
                      actualizar("concesionario", event.target.value)
                    }
                  >
                    <option value="">Elija el partner</option>
                    {concesionarios.map((concesionario) => (
                      <option key={concesionario.id} value={concesionario.id}>
                        {concesionario.nombre}
                      </option>
                    ))}
                  </select>
                </Campo>
              )}
              <Campo
                id="fecha_fin_garantia"
                etiqueta="Fin de garantía"
                ayuda="Déjelo vacío si el equipo no tiene garantía registrada."
                error={errorDe("fecha_fin_garantia")}
                className="col-md-4"
              >
                <input
                  type="date"
                  className="form-control"
                  min={valores.fecha_adquisicion || undefined}
                  value={valores.fecha_fin_garantia}
                  onChange={(event) =>
                    actualizar("fecha_fin_garantia", event.target.value)
                  }
                />
              </Campo>
              <Campo
                id="observaciones"
                etiqueta="Observaciones"
                error={errorDe("observaciones")}
                className="col-12"
              >
                <textarea
                  className="form-control"
                  rows={2}
                  value={valores.observaciones}
                  onChange={(event) =>
                    actualizar("observaciones", event.target.value)
                  }
                />
              </Campo>
            </div>
          </section>

          <div className="mz-actions justify-content-end mt-3">
            <button
              type="button"
              className="btn btn-cancelar"
              onClick={() =>
                navigate(esEdicion ? `/admin/activos/${id}` : "/admin/activos")
              }
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSaving}
            >
              {isSaving
                ? "Guardando…"
                : esEdicion
                  ? "Guardar cambios"
                  : "Registrar activo"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
