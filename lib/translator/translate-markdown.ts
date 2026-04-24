import "server-only";

import { protectMarkdown, translationStructureOk, unprotectMarkdown } from "./markdown-protect";
import { translateWithOpenRouter } from "./openrouter";

const MAX_CHARS = 200_000;

export type TranslateMarkdownResult =
  | { ok: true; markdown: string; tokensIn: number; tokensOut: number; modelUsed: string }
  | { ok: false; code: "too_large" | "structure" | "openrouter"; message: string };

export async function translateMarkdownDocument(
  source: string,
  targetLang: string,
  modelId?: string,
): Promise<TranslateMarkdownResult> {
  if (source.length > MAX_CHARS) {
    return { ok: false, code: "too_large", message: `正文超过 ${MAX_CHARS} 字符上限` };
  }

  const { payload, placeholders } = protectMarkdown(source);
  const systemPrompt = [
    "You translate Markdown technical documentation.",
    "Rules:",
    "- Preserve every placeholder token exactly (tokens look like ⟦B0⟧, ⟦I1⟧). Do not omit, translate, or renumber them.",
    "- Keep Markdown structure: headings, lists, links, blank lines.",
    "- Do not wrap the result in code fences.",
    `- Target locale: ${targetLang}.`,
  ].join("\n");

  try {
    const { text, tokensIn, tokensOut, modelUsed } = await translateWithOpenRouter(
      systemPrompt,
      payload,
      modelId,
    );
    const restored = unprotectMarkdown(text, placeholders);
    if (!translationStructureOk(source, restored)) {
      return {
        ok: false,
        code: "structure",
        message:
          "译文与原文的 Markdown 代码块（```）数量不一致，已放弃写入。常见原因：模型改写/合并了代码块，或未原样保留 ⟦B0⟧ 等占位符。可重试、换模型，或把超大代码块拆成多段后再译。",
      };
    }
    return { ok: true, markdown: restored, tokensIn, tokensOut, modelUsed };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const hint =
      message.includes("Provider returned error") && message.length < 40
        ? `${message} 建议：查看运行 next dev 的终端是否有更完整 JSON；检查 OpenRouter 用量/限流，或稍后重试。`
        : message;
    return { ok: false, code: "openrouter", message: hint };
  }
}
