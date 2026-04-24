/**
 * 将 Markdown 导出为接近 github.com 网页预览效果的 PDF（GFM + github-markdown-css + Mermaid）。
 * 用法: node scripts/export-markdown-github-pdf.mjs <输入.md> [输出.pdf]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { marked } from "marked";
import puppeteer from "puppeteer";

const input = process.argv[2];
const output =
  process.argv[3] ?? String(input).replace(/\.md$/i, ".github-style.pdf");

if (!input) {
  console.error(
    "用法: node scripts/export-markdown-github-pdf.mjs <输入.md> [输出.pdf]",
  );
  process.exit(1);
}

const md = fs.readFileSync(input, "utf8");

/** 非贪婪到第一个闭合 ```；正文代码块内勿单独出现未配对的 ``` */
const mermaidFence = /```\s*mermaid\s*\r?\n([\s\S]*?)```/gi;

const mermaidBlocks = [];
const mdWithoutMermaid = md.replace(mermaidFence, (_, code) => {
  mermaidBlocks.push(code.replace(/\r\n/g, "\n").trimEnd());
  return "\n\n<div class=\"mermaid\"></div>\n\n";
});

marked.setOptions({
  gfm: true,
  breaks: false,
});

const bodyInner = marked.parse(mdWithoutMermaid);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.6.1/github-markdown-light.min.css" />
<style>
  @page { margin: 14mm; }
  body {
    margin: 0;
    background: #ffffff;
  }
  .markdown-body {
    box-sizing: border-box;
    min-width: 200px;
    max-width: 980px;
    margin: 0 auto;
    padding: 32px 40px 56px;
  }
  .markdown-body pre {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .markdown-body table {
    display: block;
    overflow-x: auto;
    max-width: 100%;
  }
  .markdown-body .mermaid {
    margin: 1em 0;
    overflow-x: auto;
    overflow-y: visible;
    text-align: left;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .markdown-body .mermaid svg {
    max-width: 100% !important;
    height: auto !important;
  }
  .markdown-body .mermaid-error {
    color: #cf222e;
    font-size: 12px;
    white-space: pre-wrap;
    text-align: left;
    padding: 8px;
    border: 1px solid #ff818266;
    border-radius: 6px;
    background: #fff8f8;
  }
  .markdown-body pre,
  .markdown-body .highlight {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  @media print {
    .markdown-body { padding: 16px 20px 28px; max-width: none; }
  }
</style>
</head>
<body>
<article class="markdown-body">
${bodyInner}
</article>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
</body>
</html>`;

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  page.on("console", (msg) => {
    const t = msg.type();
    if (t === "error" || t === "warning") {
      console.warn(`[浏览器 ${t}]`, msg.text());
    }
  });
  await page.setViewport({ width: 1100, height: 1400, deviceScaleFactor: 2 });
  await page.setContent(html, {
    waitUntil: "networkidle0",
    timeout: 180_000,
  });

  await page.waitForFunction(
    () => typeof globalThis.mermaid !== "undefined",
    { timeout: 60_000 },
  );

  const renderErrors = await page.evaluate(async (codes) => {
    const m = globalThis.mermaid;
    m.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "loose",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
      flowchart: { htmlLabels: true, useMaxWidth: true },
      sequence: { useMaxWidth: true, wrap: true },
      er: { useMaxWidth: true },
    });

    const nodes = document.querySelectorAll("article.markdown-body div.mermaid");
    const errors = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const code = codes[i];
      if (code == null || code === "") continue;
      try {
        const id = `mmd-pdf-${i}`;
        const { svg } = await m.render(id, code);
        node.innerHTML = svg;
      } catch (e) {
        const msg = e?.message ?? String(e);
        errors.push({ index: i, message: msg });
        const pre = document.createElement("pre");
        pre.className = "mermaid-error";
        pre.textContent = `Mermaid 渲染失败（图 ${i + 1}）：${msg}`;
        node.replaceChildren(pre);
      }
    }

    return errors;
  }, mermaidBlocks);

  if (renderErrors.length) {
    console.warn("部分 Mermaid 图未成功渲染：", renderErrors);
  }

  const svgCount = await page.evaluate(
    () => document.querySelectorAll("article.markdown-body div.mermaid svg").length,
  );
  if (svgCount !== mermaidBlocks.length) {
    console.warn(
      `Mermaid 图数量不一致：已渲染 SVG ${svgCount} / 源码块 ${mermaidBlocks.length}（若小于预期请检查语法或浏览器控制台）`,
    );
  }

  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );

  await page.pdf({
    path: output,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: false,
    margin: { top: "12mm", bottom: "14mm", left: "12mm", right: "12mm" },
  });

  console.log("已写入:", path.resolve(output));
} finally {
  await browser.close();
}
