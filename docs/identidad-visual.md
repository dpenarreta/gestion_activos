# Identidad visual

La interfaz usa la **identidad base de la Matriz Administrativa de
Obligaciones**: colores, tipografía, componentes y modo claro/oscuro. Esta guía
dice qué marcado usar en cada pantalla para que todas se vean como parte del
mismo sistema.

## Las tres capas de estilo

| Archivo | Qué es | ¿Se edita? |
| --- | --- | --- |
| `frontend/src/styles/identidad-base.css` | Copia literal de la Matriz (`mz-*`, `login-*`) | **No.** Se regenera con `sh scripts/sincronizar-identidad.sh` |
| `frontend/src/styles/identidad-puente.css` | Conecta el tema editable con los `mz-*`, alinea Bootstrap y fija las convenciones de abajo | Sí, con cuidado: afecta a todas las pantallas |
| `pages/…/*.css`, `components/…/*.css` | Lo propio de cada pantalla | Sí, pero solo lo que los `mz-*` no cubren |

En las hojas de cada pantalla, **nada de colores fijos**: siempre tokens
(`var(--mz-ink)`, `var(--mz-border)`, `var(--mz-bad-fg)`…), que ya cambian
solos en modo oscuro. El catálogo visual de todos los componentes está en
`matriz_admin/docs/identidad-base/ejemplo.html`.

## Recetas

### Encabezado de la vista

La barra superior ya muestra la sección (sale del menú). Cada pantalla abre con
su encabezado propio; **sin migas de pan** (`Breadcrumbs`), que la barra
superior y el menú ya cubren.

```jsx
<div className="mz-view-head">
  <div>
    <h2>Departamentos</h2>
    <p className="mz-desc">Una frase que diga para qué sirve la pantalla.</p>
  </div>
  <div className="mz-view-actions">
    <Link to="…" className="btn btn-primary btn-sm">
      <Icon name="plus-lg" /> Nuevo departamento
    </Link>
  </div>
</div>
```

### Filtros

```jsx
<form className="mz-filter-bar" onSubmit={…} role="search">
  <label className="mz-fb-search">
    <Icon name="search" />
    <span className="visually-hidden">Buscar departamentos</span>
    <input type="search" placeholder="Buscar por nombre o código" … />
  </label>
  <select className="form-select form-select-sm" aria-label="Filtrar por estado">…</select>
  <div className="mz-chips">
    <button type="button" className="is-on" aria-pressed="true">Todas</button>…
  </div>
  <button type="submit" className="btn btn-outline-secondary btn-sm">Buscar</button>
</form>
```

### Listados

```jsx
<div className="mz-table-wrap">
  <table className="mz-table">
    <thead>
      <tr><th>Código</th><th>Nombre</th><th className="num">Activos</th><th>Estado</th><th aria-label="Acciones" /></tr>
    </thead>
    <tbody>
      <tr>
        <td className="mz-code">DEP-01</td>
        <td className="mz-strong">Contabilidad</td>
        <td className="num">12</td>
        <td><span className="mz-pill mz-pill--ok">Activo</span></td>
        <td className="acciones"><Link className="btn btn-outline-primary btn-sm" …>Editar</Link></td>
      </tr>
      <tr className="mz-empty-row"><td colSpan={5}>Sin departamentos registrados</td></tr>
    </tbody>
  </table>
</div>
<Paginacion … />   {/* ya dibuja .mz-pager */}
```

- `mz-table` tiene 640px de mínimo; `mz-table--ancha` (1100px) para listados de
  muchas columnas; `mz-table--clicable` solo si la fila entera abre algo.
- Celdas: `num` (cifras a la derecha), `acciones`, `mz-code`, `mz-mono`,
  `mz-strong`, `mz-faint`, `mz-ellipsis`.
- En pantallas estrechas la tabla se queda con scroll horizontal. Si el listado
  ofrece versión en tarjetas, la tabla lleva `mz-table-wrap--con-tarjetas` y va
  seguida de `<div className="mz-cards">` con `mz-card-row`.
- Filas de agrupación: `<tr className="mz-group-row"><td colSpan>…</td></tr>`.

### Estados

| Bootstrap | Identidad |
| --- | --- |
| `badge text-bg-success` | `mz-pill mz-pill--ok` |
| `badge text-bg-warning` | `mz-pill mz-pill--warn` |
| `badge text-bg-danger` | `mz-pill mz-pill--bad` |
| `badge text-bg-secondary` / `bg-light` | `mz-pill mz-pill--neutral` |
| `badge text-bg-info` / `primary` | `mz-pill mz-pill--info` (añadida en el puente: «en curso», ni buena ni mala noticia) |
| `alert alert-danger` | `mz-alert mz-alert--bad` + `role="alert"` + `<Icon name="x-octagon" />` |
| `alert alert-warning` | `mz-alert mz-alert--warn` + `<Icon name="exclamation-triangle" />` |
| `alert alert-info` / `alert-success` / `alert-secondary` | `mz-alert mz-alert--info` + `role="status"` + `<Icon name="info-circle" />` o `check2-circle` |
| `text-muted` | `mz-faint` |
| `small` | `mz-small` |

El texto de un `mz-alert` va después del ícono; si son varias líneas, dentro de
un `<div>`.

### Tarjetas y fichas

```jsx
<section className="mz-card">
  <div className="mz-card-head"><h3>Datos generales</h3>{/* acción opcional */}</div>
  <div className="mz-card-body">
    <div className="mz-kv-grid">
      <div className="mz-kv"><span className="mz-kv-label">Responsable</span>Ana Pérez</div>
      <div className="mz-kv mz-kv--full"><span className="mz-kv-label">Notas</span>…</div>
    </div>
  </div>
</section>
```

- El rótulo de `mz-kv` es un `<span className="mz-kv-label">`, **no** un
  `<label>` (el lint de accesibilidad exige que todo `<label>` tenga su campo).
- Dos columnas: `mz-grid-2` (1,3 : 0,9) o `mz-grid-2 mz-grid-2--even`.
  Bloques apilados: `mz-stack`.
- Indicadores: `mz-kpi-grid` con `mz-kpi mz-kpi--bad|warn|ok|info` (`mz-kpi-top`,
  `mz-kpi-label`, `mz-kpi-icon`, `mz-kpi-value`, `mz-kpi-sub`).
- Listas de elementos clicables: `mz-row` (`mz-row-ic`, `mz-row-info`,
  `mz-row-end`). Historial: `mz-timeline` / `mz-tl-item`. Pestañas dentro de
  una ficha: `mz-tabs` con `button.is-active` (las ligadas a rutas ya las dibuja
  `AdminTabs`). Vacíos: `mz-empty`. Notas al pie: `mz-note`. Secciones con
  título en versalitas: `mz-section` + `<h4>`.

### Formularios

```jsx
<section className="mz-card">
  <div className="mz-card-head"><h3>Datos del departamento</h3></div>
  <form className="mz-card-body" onSubmit={…}>
    <div className="mz-field-grid">
      <div className="mz-field">
        <label htmlFor="dep-nombre">Nombre</label>
        <input id="dep-nombre" className="form-control" … />
        {error && <div className="mz-field-error">{error}</div>}
      </div>
      <div className="mz-field mz-field--full">…</div>
    </div>
    <div className="mz-actions justify-content-end mt-3">
      <Link className="btn btn-cancelar" …>Cancelar</Link>
      <button type="submit" className="btn btn-primary">Guardar</button>
    </div>
  </form>
</section>
```

- Los campos siguen siendo los de Bootstrap (`form-control`, `form-select`,
  `form-check`), que el puente ya pinta con la identidad. Lo que cambia es la
  rejilla: `mz-field-grid` (dos columnas, una en el teléfono) en lugar de
  `row`/`col-*`.
- Si una pantalla depende de `row g-3` por algo concreto (filas de tres
  campos, alineaciones existentes), puede conservarlo; lo que importa es que
  esté dentro de la tarjeta y con los tokens.
- Ayuda bajo el campo: `form-text` (el puente le da tamaño y color).
- Subida de archivos: `mz-drop` (`is-drag` al arrastrar).

### Diálogos

`ModalDialog` y `ConfirmDialog` ya dibujan `mz-overlay` / `mz-modal`. Un
diálogo propio usa la misma estructura: `mz-panel-head` (título `h3` y botón
`mz-close`), `mz-panel-body` y `mz-panel-foot`.

### Botones

Los de Bootstrap con los ajustes del proyecto: `btn-primary` (acción
principal), `btn-outline-primary` (acción de fila), `btn-outline-secondary`
(secundaria), `btn-cancelar` (descarta), `btn-outline-danger` (borra),
`btn-exportar` (saca datos). Ícono delante del texto con `<Icon name="…" />`.

## Pruebas

Las pruebas buscan por rol, etiqueta y texto, no por clase. Si una prueba
dependía de una clase de Bootstrap (`.alert-danger`, `.badge`), se cambia por su
equivalente `mz-*` o, mejor, por `getByRole("alert")` o `getByText`. Los
selectores e2e de errores aceptan `.mz-alert--bad, .alert-danger`.
