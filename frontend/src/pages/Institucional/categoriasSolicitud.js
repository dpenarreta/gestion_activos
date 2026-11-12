import { createContext, useContext } from "react";

import { RUTA_INSTITUCIONAL } from "../../modulos/permisosInstitucional";

/*
 * Lo que cambia entre «Solicitud de proyectos» y «Solicitud de procesos»
 * (US-008, 12/11/2026): los textos, la dirección y los permisos. Las dos
 * pantallas son las mismas (`SolicitudProyectosPage`, `TiposProyectoPage`) y
 * leen de aquí todo lo que dice «proyecto» o «proceso».
 *
 * Las dos palabras son masculinas, así que los artículos («un», «el», «del»)
 * no cambian; aun así, cada frase va entera para que se lea tal cual en un
 * solo lugar y no armada a pedazos.
 */
export const CATEGORIAS_SOLICITUD = {
  proyecto: {
    categoria: "proyecto",
    ruta: `${RUTA_INSTITUCIONAL}/proyectos`,
    // Donde buscar una solicitud que aquí da 404.
    rutaOtra: `${RUTA_INSTITUCIONAL}/procesos`,
    permisos: {
      verTodas: "proyectos.ver_todas",
      configurar: "proyectos.configurar",
      // Pedir proyectos no exige permiso.
      solicitar: null,
    },
    textos: {
      titulo: "Solicitud de proyectos",
      descripcion:
        "Pida un proyecto con su plantilla llena y siga su aprobación; atienda los que le toquen.",
      columna: "Proyecto",
      pestanas: "Solicitudes de proyecto",
      tipos: "Tipos de proyecto",
      tipoDe: "Tipo de proyecto",
      nuevaSolicitud: "Nueva solicitud de proyecto",
      solicitudDe: "Solicitud de proyecto",
      nombre: "Nombre del proyecto",
      faltaNombre: "Escriba el nombre del proyecto.",
      completeDatos: "Complete los datos del proyecto",
      sinTiposParaSolicitar: "Todavía no hay tipos de proyecto para solicitar.",
      errorTipos: "No se pudieron cargar los tipos de proyecto.",
      // Sin tipos activos (el primer día).
      vacioConfigura:
        "Todavía no hay tipos de proyecto. Cree el primero para que se puedan pedir.",
      configurarTipos: "Configurar tipos de proyecto",
      vacioSinTipos:
        "Todavía no hay proyectos para pedir. Cuando el área responsable los publique, aparecerán aquí.",
      // Sin permiso para pedir ni configurar: sin invitar a pedir.
      vacioSinPermiso: "Todavía no hay tipos de proyecto.",
      // Un enlace `?solicitud=` de la otra categoría (el servidor da 404).
      // Sin el número (PRY/PRC): quien sigue el enlace no lo ve.
      noEncontrada:
        "No se encontró la solicitud aquí. Puede que sea de Solicitud de procesos.",
      abrirEnOtra: "Abrir en Solicitud de procesos",
      // Tipos de proyecto (configuración)
      descripcionTipos:
        "Los proyectos que se pueden solicitar: su plantilla, los datos que se piden y quién aprueba, autoriza y revisa antes de iniciarlos.",
      nuevoTipo: "Nuevo tipo de proyecto",
      crearTipo: "Crear tipo de proyecto",
      nombreDelTipo: "Nombre del tipo de proyecto",
      faltaNombreDelTipo: "Escriba el nombre del tipo de proyecto.",
      mensajeNombreDelTipo: "Nombre del tipo de proyecto: escríbalo.",
      ejemploNombreDelTipo: "Ej.: Desarrollo de un reporte",
      campoInicial: "Objetivo del proyecto",
      sinTipos:
        "Todavía no hay tipos de proyecto. Cree el primero con «Nuevo tipo de proyecto»: su plantilla, su formulario y quién lo aprueba.",
      volver: "Volver a Solicitud de proyectos",
      errorGuardarTipo: "No se pudo guardar el tipo de proyecto.",
      tipoCreado: (nombre) => `Tipo de proyecto «${nombre}» creado.`,
      tipoActualizado: (nombre) => `Tipo de proyecto «${nombre}» actualizado.`,
      borrarTipo: (nombre) => `¿Borrar el tipo de proyecto «${nombre}»?`,
      sinCamposPropios:
        "Sin campos propios: solo se pide el nombre del proyecto y la plantilla llena.",
      formularioAyuda:
        "Además del nombre del proyecto y la plantilla llena, se piden estos campos, en este orden. Los obligatorios no dejan enviar la solicitud vacíos.",
      pasosAyuda:
        "Cada paso lo decide cualquiera de los indicados; aprobado, pasa al siguiente. Aprobado el último, el proyecto se puede iniciar. Si alguien lo rechaza, no se inicia.",
      rutaSolicita: "quien pide el proyecto, con la plantilla llena",
      rutaFin: "el proyecto se puede iniciar",
      administra: "quien administra los tipos de proyecto",
    },
  },
  proceso: {
    categoria: "proceso",
    ruta: `${RUTA_INSTITUCIONAL}/procesos`,
    rutaOtra: `${RUTA_INSTITUCIONAL}/proyectos`,
    permisos: {
      verTodas: "procesos.ver_todas",
      configurar: "procesos.configurar",
      // De todo cargo (`PERMISOS_BASE`), como `licencias.solicitar`.
      solicitar: "procesos.solicitar",
    },
    textos: {
      titulo: "Solicitud de procesos",
      descripcion:
        "Pida un proceso con su plantilla llena y siga su aprobación; atienda los que le toquen.",
      columna: "Proceso",
      pestanas: "Solicitudes de proceso",
      tipos: "Tipos de proceso",
      tipoDe: "Tipo de proceso",
      nuevaSolicitud: "Nueva solicitud de proceso",
      solicitudDe: "Solicitud de proceso",
      nombre: "Nombre del proceso",
      faltaNombre: "Escriba el nombre del proceso.",
      completeDatos: "Complete los datos del proceso",
      sinTiposParaSolicitar: "Todavía no hay tipos de proceso para solicitar.",
      errorTipos: "No se pudieron cargar los tipos de proceso.",
      vacioConfigura:
        "Todavía no hay tipos de proceso. Cree el primero para que se puedan pedir.",
      configurarTipos: "Configurar tipos de proceso",
      vacioSinTipos:
        "Todavía no hay procesos para pedir. Cuando el área responsable los publique, aparecerán aquí.",
      vacioSinPermiso: "Todavía no hay tipos de proceso.",
      noEncontrada:
        "No se encontró la solicitud aquí. Puede que sea de Solicitud de proyectos.",
      abrirEnOtra: "Abrir en Solicitud de proyectos",
      descripcionTipos:
        "Los procesos que se pueden solicitar: su plantilla, los datos que se piden y quién aprueba, autoriza y revisa antes de iniciarlos.",
      nuevoTipo: "Nuevo tipo de proceso",
      crearTipo: "Crear tipo de proceso",
      nombreDelTipo: "Nombre del tipo de proceso",
      faltaNombreDelTipo: "Escriba el nombre del tipo de proceso.",
      mensajeNombreDelTipo: "Nombre del tipo de proceso: escríbalo.",
      ejemploNombreDelTipo: "Ej.: Alta de un proveedor",
      campoInicial: "Objetivo del proceso",
      sinTipos:
        "Todavía no hay tipos de proceso. Cree el primero con «Nuevo tipo de proceso»: su plantilla, su formulario y quién lo aprueba.",
      volver: "Volver a Solicitud de procesos",
      errorGuardarTipo: "No se pudo guardar el tipo de proceso.",
      tipoCreado: (nombre) => `Tipo de proceso «${nombre}» creado.`,
      tipoActualizado: (nombre) => `Tipo de proceso «${nombre}» actualizado.`,
      borrarTipo: (nombre) => `¿Borrar el tipo de proceso «${nombre}»?`,
      sinCamposPropios:
        "Sin campos propios: solo se pide el nombre del proceso y la plantilla llena.",
      formularioAyuda:
        "Además del nombre del proceso y la plantilla llena, se piden estos campos, en este orden. Los obligatorios no dejan enviar la solicitud vacíos.",
      pasosAyuda:
        "Cada paso lo decide cualquiera de los indicados; aprobado, pasa al siguiente. Aprobado el último, el proceso se puede iniciar. Si alguien lo rechaza, no se inicia.",
      rutaSolicita: "quien pide el proceso, con la plantilla llena",
      rutaFin: "el proceso se puede iniciar",
      administra: "quien administra los tipos de proceso",
    },
  },
};

/** La configuración de una categoría; una desconocida es un error de
 * programación, no algo que deba verse como proyecto. */
export function configDeCategoria(categoria = "proyecto") {
  const config = CATEGORIAS_SOLICITUD[categoria];
  if (!config) {
    throw new Error(`Categoría de solicitud desconocida: ${categoria}`);
  }
  return config;
}

/** Para los componentes de dentro de las pantallas (editores, ventanas), sin
 * pasar la categoría de mano en mano. */
export const CategoriaSolicitudContext = createContext(
  CATEGORIAS_SOLICITUD.proyecto,
);

export function useCategoriaSolicitud() {
  return useContext(CategoriaSolicitudContext);
}
