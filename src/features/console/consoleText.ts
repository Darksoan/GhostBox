const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };

function decodeEntities(text: string) {
  if (typeof DOMParser !== "undefined") return new DOMParser().parseFromString(text, "text/html").documentElement.textContent ?? text;
  return text.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (match, name: string) => {
    if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#") && name !== "#39") return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** Texto da loja (HTML) em parágrafos simples, um por bloco ou quebra de linha. */
export function storeTextParagraphs(html: string | undefined): string[] {
  if (!html?.trim()) return [];
  const marked = html.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|li|h\d|div|ul|ol)\s*>/gi, "\n");
  const text = decodeEntities(marked.replace(/<[^>]+>/g, ""));
  return text.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Linhas curtas todas em caixa alta na descrição da loja funcionam como subtítulos. */
export const isStoreHeading = (line: string) => line.length < 70 && line === line.toUpperCase() && line !== line.toLowerCase();
