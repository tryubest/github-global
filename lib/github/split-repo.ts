import "server-only";

export function splitRepoFullName(fullName: string): { owner: string; repo: string } {
  const idx = fullName.indexOf("/");
  if (idx <= 0 || idx === fullName.length - 1) {
    throw new Error(`Invalid repository fullName: ${fullName}`);
  }
  return { owner: fullName.slice(0, idx), repo: fullName.slice(idx + 1) };
}

/** PRD F-09：README.md → README.zh-CN.md */
export function translatedFilePath(sourcePath: string, lang: string): string {
  const dot = sourcePath.lastIndexOf(".");
  if (dot <= 0) {
    return `${sourcePath}.${lang}.md`;
  }
  return `${sourcePath.slice(0, dot)}.${lang}${sourcePath.slice(dot)}`;
}

/** GitHub 网页上浏览某 ref 下的文件路径（用于任务页「查看原文/译文」）。 */
export function githubBlobWebUrl(fullName: string, ref: string, filePath: string): string {
  const { owner, repo } = splitRepoFullName(fullName);
  const refEnc = encodeURIComponent(ref);
  const pathEnc = filePath.split("/").map((p) => encodeURIComponent(p)).join("/");
  return `https://github.com/${owner}/${repo}/blob/${refEnc}/${pathEnc}`;
}
