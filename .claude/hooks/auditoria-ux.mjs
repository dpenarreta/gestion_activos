#!/usr/bin/env node
/**
 * Auditoría UX/UI antes de cada commit (27/10/2026).
 *
 * Hook PreToolUse de Bash (`git commit`): si hay cambios de interfaz
 * (frontend/src/**\/*.jsx o *.css) que todavía no pasaron por el subagente
 * `auditor-ux-ui`, niega el commit y le dice a Claude qué archivos auditar.
 * Después de auditar y aplicar (o descartar con motivo) los ajustes, Claude
 * registra la auditoría con:
 *
 *     node .claude/hooks/auditoria-ux.mjs --aprobar
 *
 * La aprobación es una huella de esos cambios (diff contra HEAD más los
 * archivos nuevos): si después se vuelve a tocar la interfaz, hay que auditar
 * de nuevo. Se guarda en .git/, fuera del repositorio.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const raiz = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const git = (...args) =>
  execFileSync("git", args, {
    cwd: raiz,
    encoding: "utf8",
    maxBuffer: 64 << 20,
    stdio: ["ignore", "pipe", "ignore"],
  });

const ES_INTERFAZ = /^frontend\/src\/.*\.(jsx|css)$/;

function cambiosDeInterfaz() {
  const modificados = git("diff", "HEAD", "--name-only", "--", "frontend/src")
    .split("\n")
    .filter((f) => ES_INTERFAZ.test(f));
  const nuevos = git("ls-files", "--others", "--exclude-standard", "--", "frontend/src")
    .split("\n")
    .filter((f) => ES_INTERFAZ.test(f));
  return [...new Set([...modificados, ...nuevos])].sort();
}

/** Huella del contenido actual de esos archivos (no del diff: el diff cambia
 * al hacer `git add` de un archivo nuevo, y la aprobación se perdía). */
function huella(archivos) {
  const h = createHash("sha256");
  for (const f of archivos) {
    const ruta = join(raiz, f);
    h.update(`${f}\0`);
    h.update(existsSync(ruta) ? readFileSync(ruta) : "(borrado)");
  }
  return h.digest("hex");
}

const marca = join(raiz, git("rev-parse", "--git-dir").trim(), "ux-auditado");

if (process.argv.includes("--aprobar")) {
  const archivos = cambiosDeInterfaz();
  if (!archivos.length) {
    console.log("No hay cambios de interfaz pendientes de auditar.");
  } else {
    writeFileSync(marca, huella(archivos));
    console.log(`Auditoría UX/UI registrada para ${archivos.length} archivo(s):`);
    for (const f of archivos) console.log(`  ${f}`);
  }
  process.exit(0);
}

// Modo hook: solo los `git commit`.
let entrada = {};
try {
  entrada = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}
const comando = entrada?.tool_input?.command ?? "";
if (!/\bgit\b[^\n;&|]*\bcommit\b/.test(comando)) process.exit(0);

const archivos = cambiosDeInterfaz();
if (!archivos.length) process.exit(0);
if (existsSync(marca) && readFileSync(marca, "utf8").trim() === huella(archivos)) {
  process.exit(0);
}

const lista = archivos.map((f) => `  - ${f}`).join("\n");
const razon = `Auditoría UX/UI pendiente: este commit trae cambios de interfaz que el auditor todavía no revisó.

Archivos a auditar:
${lista}

Antes de hacer el commit:
1. Lanza el subagente «auditor-ux-ui» (Agent, subagent_type: "auditor-ux-ui") con esos archivos y, si aplica, la pantalla en http://localhost:5174 donde se ven, pidiéndole que pruebe el desarrollo.
2. Aplica los ajustes de severidad Crítica y Alta (y los Media que sean baratos). Los que descartes, dilos al usuario con el motivo.
3. Vuelve a correr las pruebas de lo tocado.
4. Registra la auditoría: node .claude/hooks/auditoria-ux.mjs --aprobar
5. Repite el commit.

Informa al usuario qué encontró el auditor y qué se ajustó.`;

process.stdout.write(
  JSON.stringify({
    systemMessage: `Auditoría UX/UI pendiente para ${archivos.length} archivo(s) de interfaz: se lanza el auditor antes del commit.`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: razon,
    },
  }),
);
process.exit(0);
