#!/usr/bin/env node
// Guarda do sistema de design: impede que valores crus voltem a se espalhar
// pelos estilos depois da migração para tokens (ver plans/design-tokens-launcher.md).
//
// Não é um lint "tudo ou nada": o app ainda carrega violações herdadas. O script
// trabalha como catraca (ratchet) — falha só quando a contagem de um arquivo SOBE
// em relação ao baseline. Reduzir é sempre permitido; para gravar a redução (e
// travar o novo teto), rode com --update.
//
//   node scripts/check-tokens.mjs            verifica
//   node scripts/check-tokens.mjs --list     lista todas as violações
//   node scripts/check-tokens.mjs --update   regrava o baseline
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(ROOT, "src");
const BASELINE_PATH = join(ROOT, "scripts", "token-baseline.json");

// src/styles/ é onde os tokens são DEFINIDOS — valores crus ali são o ponto.
const EXEMPT_DIRS = [join("src", "styles")];

// Exceções por ARQUIVO (não por diretório): apenas FALSO-POSITIVO conhecido —
// hex/rgb/hsl em contexto não-visual (IDs de app, regex, docs, exemplos).
// Só entra aqui com comentário explicando o porquê; arquivos TS/TSX reais
// com cor crua são violação e ficam fora da lista.
//
// Paletas de DADOS (não estilos): cores de acento dinâmicas consumidas em runtime
// (orbs de categoria do catálogo, acentos de seed/avatar, destaque de contas Steam).
// São dados arbitrários por categoria/conta, fora da rampa neutra — tokenizar
// exigiria um token por categoria e ainda assim só serviria a um único consumidor.
const EXCEPTIONS = [
  "src/constants/catalogue.ts", // orbs de categoria: 5 hue distintos arbitrários
  "src/utils/gameSeed.ts", // paleta de acento para seed de avatar (5 cores)
  "src/lib/profileHistoryGames.ts", // accent do jogo em destaque no histórico
  "src/utils/steamLibraryMerge.ts", // hex de destaque de conta Steam
  "src/utils/storage.ts", // hex de acento de conta persistido
];
const RULES = [
  {
    id: "raw-hex",
    label: "cor hex crua",
    hint: "use um token de --styles/_primitives.scss (ex.: var(--n-3), var(--gold-500))",
    // 3/4/6/8 dígitos, sem capturar interpolação Sass #{...} nem IDs de seletor.
    re: /#[0-9a-fA-F]{3,8}\b/g,
    exts: [".scss", ".ts", ".tsx"],
  },
  {
    id: "raw-rgb",
    label: "rgb()/rgba() cru",
    hint: "use --a-hover/--a-active/--a-scrim-* ou color-mix() sobre um token",
    re: /\brgba?\(/g,
    exts: [".scss", ".ts", ".tsx"],
  },
  {
    id: "raw-hsl",
    label: "hsl()/hsla() cru",
    hint: "use tokens ou palette por papel",
    re: /\bhsla?\(/g,
    exts: [".ts", ".tsx"],
  },
  {
    id: "direct-primitive",
    label: "token primitivo usado direto no componente",
    hint: "use tokens semanticos (--surface-*, --text-*, --overlay-*) — primitivos so em src/styles/",
    re: /\bvar\(--(?:n|a|gold|red|green|black|white)-/g,
    exts: [".scss"],
  },
  {
    id: "font-size-px",
    label: "font-size literal em px",
    hint: "use a escala --fs-100 … --fs-800",
    re: /font-size:\s*-?[\d.]+px/g,
    exts: [".scss"],
  },
  {
    id: "z-index-literal",
    label: "z-index literal de camada global (>= 10)",
    // 1–9 são empilhamento local dentro do próprio componente e continuam livres;
    // é a partir de 10 que o valor vira camada do app e precisa da escala nomeada.
    // A regra permanece na escala global — z-index local (1–9) segue permitido.
    hint: "use --z-raised/--z-sticky/--z-header/--z-drawer/--z-modal/--z-popover/--z-toast/--z-tooltip (z-index local 1–9 fica no componente; 10+ é camada global)",
    re: /z-index:\s*(\d{2,})\b/g,
    exts: [".scss"],
  },
  {
    id: "box-shadow-literal",
    label: "box-shadow literal",
    hint: "use --shadow-1/--shadow-2/--shadow-3/--shadow-inset-hairline",
    re: /box-shadow:\s*(?!none|var\(|inherit|initial|unset)\S/g,
    exts: [".scss"],
  },
];

/** Remove comentários // e comentários de bloco, preservando o número de linhas. */
function stripComments(source) {
  const out = [];
  let inBlock = false;
  for (const rawLine of source.split("\n")) {
    let line = rawLine;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) {
        out.push("");
        continue;
      }
      line = " ".repeat(end + 2) + line.slice(end + 2);
      inBlock = false;
    }
    for (;;) {
      const start = line.indexOf("/*");
      if (start === -1) break;
      const end = line.indexOf("*/", start + 2);
      if (end === -1) {
        line = line.slice(0, start);
        inBlock = true;
        break;
      }
      line = line.slice(0, start) + " ".repeat(end + 2 - start) + line.slice(end + 2);
    }
    const lineComment = line.indexOf("//");
    if (lineComment !== -1) line = line.slice(0, lineComment);
    out.push(line);
  }
  return out;
}

function collectFiles(dir, exts, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectFiles(full, exts, acc);
    else if (exts.some((e) => entry.endsWith(e))) acc.push(full);
  }
  return acc;
}

function isExempt(relPath) {
  return EXEMPT_DIRS.some((d) => relPath.startsWith(d + sep) || relPath === d);
}

function isException(relPath) {
  return EXCEPTIONS.includes(relPath);
}

function scan() {
  const findings = [];
  if (!existsSync(SRC)) return findings;
  for (const file of collectFiles(SRC, [".scss", ".ts", ".tsx"])) {
    const rel = relative(ROOT, file);
    if (isExempt(rel)) continue;
    const relPosix = rel.split(sep).join("/");
    if (isException(relPosix)) continue;
    const ext = file.slice(file.lastIndexOf("."));
    const lines = stripComments(readFileSync(file, "utf8"));
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        if (!rule.exts.includes(ext)) continue;
        rule.re.lastIndex = 0;
        let m;
        while ((m = rule.re.exec(line)) !== null) {
          findings.push({
            file: relPosix,
            rule: rule.id,
            line: i + 1,
            text: line.trim(),
          });
        }
      }
    });
  }
  return findings;
}

function tally(findings) {
  const counts = {};
  for (const f of findings) {
    const key = `${f.file}::${f.rule}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const args = new Set(process.argv.slice(2));
const findings = scan();
const counts = tally(findings);

if (args.has("--list")) {
  if (findings.length === 0) console.log("Nenhuma violação.");
  for (const f of findings) {
    const rule = RULES.find((r) => r.id === f.rule);
    console.log(`${f.file}:${f.line}  [${f.rule}] ${rule.label}\n    ${f.text}\n    → ${rule.hint}`);
  }
  process.exit(0);
}

if (args.has("--update")) {
  writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + "\n");
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`Baseline gravado: ${total} violações herdadas em ${Object.keys(counts).length} entradas.`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error("check-tokens: baseline ausente. Rode `node scripts/check-tokens.mjs --update`.");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const regressions = [];
const improvements = [];

for (const key of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
  const now = counts[key] ?? 0;
  const was = baseline[key] ?? 0;
  if (now > was) regressions.push({ key, now, was });
  else if (now < was) improvements.push({ key, now, was });
}

if (regressions.length > 0) {
  console.error("\ncheck-tokens: valores crus novos nos estilos.\n");
  for (const { key, now, was } of regressions) {
    const [file, ruleId] = key.split("::");
    const rule = RULES.find((r) => r.id === ruleId);
    console.error(`  ${file}  [${ruleId}] ${was} → ${now}  (${rule.label})`);
    console.error(`      ${rule.hint}`);
    for (const f of findings.filter((x) => x.file === file && x.rule === ruleId)) {
      console.error(`      ${file}:${f.line}  ${f.text}`);
    }
    console.error("");
  }
  console.error("Use um token. Se o valor cru for mesmo necessário, justifique e rode --update.\n");
  process.exit(1);
}

if (improvements.length > 0) {
  const saved = improvements.reduce((a, i) => a + (i.was - i.now), 0);
  console.log(`check-tokens: ok — ${saved} violação(ões) a menos que o baseline.`);
  console.log("Rode `node scripts/check-tokens.mjs --update` para travar o novo teto.");
} else {
  console.log("check-tokens: ok.");
}
