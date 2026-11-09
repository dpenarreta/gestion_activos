import { apiClient } from "./client";
import { errorDeTareas } from "./tareasService";

const BASE = "/nova";

const datos = (r) => r.data;

/** Los permisos de Nova (catálogo: bloque `nova`). */
export const NOVA_ANALISIS_KPI = "nova.analisis_kpi";
export const NOVA_MENSAJE_INICIO = "nova.mensaje_inicio";
export const NOVA_NARRATIVA_INFORMES = "nova.narrativa_informes";
export {
  NOVA_CHAT,
  NOVA_CHAT_EQUIPO,
  NOVA_CONOCIMIENTO_GESTIONAR,
  NOVA_CONOCIMIENTO_VER,
} from "../modulos/permisosGestionHumana";

/** Largo máximo de un mensaje del chat (`NOVA_CHAT_MAX_CARACTERES`). */
export const NOVA_CHAT_MAX_CARACTERES = 2000;

/** El error de una llamada de Nova (contrato uniforme `{"error": {...}}`). */
export function errorDeNova(err, porDefecto = "No se pudo consultar a Nova.") {
  return errorDeTareas(err, porDefecto);
}

/**
 * Nova, la IA de Gestión Humana. Contrato: `/api/v1/nova/`. Las respuestas
 * son 200 también sin IA: `con_ia` dice si el texto lo redactó la IA y
 * `mensaje`/`aviso`, por qué no (sin clave, límite diario, fallo…). El
 * servidor vuelve a autorizar cada petición (permisos `nova.*` y el ámbito
 * del organigrama) y nunca envía a la IA nombres ni datos de salud (en el
 * modo General del chat se permiten preguntas sobre políticas de salud).
 */
export const novaService = {
  /** Qué funciones tiene y si la IA está disponible hoy. */
  me: () => apiClient.get(`${BASE}/me/`).then(datos),
  /** El análisis de los KPI de una persona (propios o de su equipo). */
  analisisKpi: (usuarioId) =>
    apiClient.get(`${BASE}/kpi/${usuarioId}/`).then(datos),
  /** La frase del inicio de Gestión Humana. */
  mensajeInicio: () => apiClient.get(`${BASE}/inicio/`).then(datos),
  /**
   * Una respuesta del chat. `historial`: los turnos anteriores
   * (`[{ rol: "usuario" | "modelo", texto }]`); el servidor no guarda la
   * conversación. Responde 200 también sin IA (`con_ia`, `mensaje`).
   */
  chat: ({ modo, mensaje, historial }) =>
    apiClient.post(`${BASE}/chat/`, { modo, mensaje, historial }).then(datos),
  /** Los documentos de la base de conocimiento (`q`: sin tildes). */
  documentos: (q = "") =>
    apiClient
      .get(`${BASE}/conocimiento/documentos/`, { params: q ? { q } : {} })
      .then(datos),
  /** Sube un PDF (multipart). */
  subirDocumento: (archivo, titulo = "") => {
    const cuerpo = new FormData();
    cuerpo.append("archivo", archivo);
    if (titulo) cuerpo.append("titulo", titulo);
    return apiClient
      .post(`${BASE}/conocimiento/documentos/`, cuerpo)
      .then(datos);
  },
  eliminarDocumento: (id) =>
    apiClient.delete(`${BASE}/conocimiento/documentos/${id}/`),
  /** «Responder solo con las fuentes» (`{ solo_fuentes, gestionar }`). */
  ajustes: () => apiClient.get(`${BASE}/conocimiento/ajustes/`).then(datos),
  /** Lo cambia quien gestiona la base (403 si no); queda en la auditoría. */
  cambiarAjustes: ({ solo_fuentes }) =>
    apiClient
      .put(`${BASE}/conocimiento/ajustes/`, { solo_fuentes })
      .then(datos),
  /** El PDF como blob, para el visor del sistema. */
  archivoDocumento: (id) =>
    apiClient
      .get(`${BASE}/conocimiento/documentos/${id}/archivo/`, {
        responseType: "blob",
      })
      .then(datos),
};
