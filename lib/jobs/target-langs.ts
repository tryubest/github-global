/** 创建翻译任务时允许的目标语言（BCP 47 风格，与产物文件名 `*.en.md` / `*.zh-CN.md` 一致）。 */
export const JOB_TARGET_LANGS = ["en", "zh-CN", "ja", "es", "fr", "de", "ru"] as const;
export type JobTargetLang = (typeof JOB_TARGET_LANGS)[number];

export const JOB_TARGET_LANG_LABELS: Record<JobTargetLang, string> = {
  en: "English（英文）",
  "zh-CN": "简体中文",
  ja: "日本語",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  ru: "Русский",
};
