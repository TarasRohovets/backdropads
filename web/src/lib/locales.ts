// Languages and markets offered across the wizard, analyze flow and settings.
// The API stores plain strings (Brief.language / Brief.targetMarket), so these
// labels are the contract — providers receive them inside the prompt.

export interface LanguageDef {
  code: string; // BCP-47-ish, for future TTS/locale use
  label: string;
}

// Top ~30 ad languages: Europe-heavy, plus the major English/Spanish/Portuguese
// dialects and the big APAC e-commerce markets.
export const LANGUAGES: LanguageDef[] = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-AU", label: "English (Australia)" },
  { code: "en-NZ", label: "English (New Zealand)" },
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "es-MX", label: "Spanish (Mexico)" },
  { code: "es-AR", label: "Spanish (Argentina)" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "pt-PT", label: "Portuguese (Portugal)" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "it-IT", label: "Italian" },
  { code: "nl-NL", label: "Dutch" },
  { code: "pl-PL", label: "Polish" },
  { code: "sv-SE", label: "Swedish" },
  { code: "da-DK", label: "Danish" },
  { code: "nb-NO", label: "Norwegian" },
  { code: "fi-FI", label: "Finnish" },
  { code: "cs-CZ", label: "Czech" },
  { code: "sk-SK", label: "Slovak" },
  { code: "ro-RO", label: "Romanian" },
  { code: "hu-HU", label: "Hungarian" },
  { code: "el-GR", label: "Greek" },
  { code: "uk-UA", label: "Ukrainian" },
  { code: "tr-TR", label: "Turkish" },
  { code: "ja-JP", label: "Japanese" },
  { code: "ko-KR", label: "Korean" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "ar-SA", label: "Arabic" },
  { code: "hi-IN", label: "Hindi" },
];

// Top e-commerce markets: the global top 5 + Europe + the big LatAm/APAC economies.
export const MARKETS: string[] = [
  "United States",
  "China",
  "United Kingdom",
  "Japan",
  "Germany",
  "South Korea",
  "France",
  "Italy",
  "Spain",
  "Netherlands",
  "Poland",
  "Sweden",
  "Portugal",
  "Canada",
  "Australia",
  "New Zealand",
  "Brazil",
  "Argentina",
  "Mexico",
  "India",
];

export const DEFAULT_LANGUAGE = "English (US)";
export const DEFAULT_MARKET = "United States";
