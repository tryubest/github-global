import "server-only";

/** 围栏代码块与行内代码替换为占位符，避免进入模型。 */
export function protectMarkdown(source: string): { payload: string; placeholders: Record<string, string> } {
  const placeholders: Record<string, string> = {};
  let n = 0;
  let text = source.replace(/```[\s\S]*?```/g, (raw) => {
    const key = `⟦B${n++}⟧`;
    placeholders[key] = raw;
    return key;
  });
  text = text.replace(/`[^`\n]+`/g, (raw) => {
    const key = `⟦I${n++}⟧`;
    placeholders[key] = raw;
    return key;
  });
  return { payload: text, placeholders };
}

export function unprotectMarkdown(translated: string, placeholders: Record<string, string>): string {
  let out = translated;
  for (const [token, raw] of Object.entries(placeholders)) {
    out = out.split(token).join(raw);
  }
  return out;
}

export function fenceDelimiterCount(md: string): number {
  const m = md.match(/```/g);
  return m ? m.length : 0;
}

export function translationStructureOk(original: string, translated: string): boolean {
  return fenceDelimiterCount(original) === fenceDelimiterCount(translated);
}
