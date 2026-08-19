import type { HttpOptions } from "../http.js";
import { requestJson } from "../http.js";
import type { SearchResult } from "../types.js";
import { truncate, uniqueBy } from "../utils.js";
import type { ProviderSearchResult, SearchProvider } from "./search-provider.js";

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      groundingSupports?: Array<{
        segment?: { startIndex?: number; endIndex?: number; text?: string };
        groundingChunkIndices?: number[];
      }>;
    };
  }>;
}

export class GeminiGroundedProvider implements SearchProvider {
  readonly name = "gemini";
  readonly source = "gemini" as const;
  constructor(private readonly apiKey: string, private readonly model: string, private readonly http: HttpOptions) {}

  async searchCompany(companyName: string, targetRoles: string[]): Promise<ProviderSearchResult> {
    const prompt = [
      `Проведи evidence-first web research компании «${companyName}».`,
      `Найди официальный сайт, актуальных людей и публичные способы связи для ролей: ${targetRoles.join(", ")}.`,
      "Особенно проверь Telegram, VK, YouTube, Threads, Instagram, TenChat, LinkedIn, интервью, вебинары, конференции и назначения.",
      "Не придумывай контакты. Каждое утверждение должно опираться на найденную публичную веб-страницу.",
    ].join("\n");
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`);
    url.searchParams.set("key", this.apiKey);
    try {
      const payload = await requestJson<GeminiResponse>(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }),
      }, this.http);
      const candidate = payload.candidates?.[0];
      const answer = candidate?.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? "").join("\n").trim() ?? "";
      const queries = candidate?.groundingMetadata?.webSearchQueries ?? [prompt];
      const supports = candidate?.groundingMetadata?.groundingSupports ?? [];
      const results: SearchResult[] = (candidate?.groundingMetadata?.groundingChunks ?? []).flatMap((chunk, chunkIndex) => {
        const web = chunk.web;
        if (!web?.uri) return [];
        const groundedText = supports
          .filter((support) => support.groundingChunkIndices?.includes(chunkIndex))
          .map((support) => support.segment?.text ?? answer.slice(support.segment?.startIndex ?? 0, support.segment?.endIndex ?? 0))
          .filter(Boolean)
          .join(" ");
        return [{ title: web.title || web.uri, url: web.uri, content: truncate(groundedText || web.title || "Grounded source", 3_000), provider: this.source, query: queries.join(" | "), publishedAt: null }];
      });
      return { provider: this.name, source: this.source, status: "used", queries, results: uniqueBy(results, (item) => item.url), warnings: results.length === 0 ? ["Gemini выполнил запрос, но не вернул grounding URL"] : [] };
    } catch (error) {
      return { provider: this.name, source: this.source, status: "failed", queries: [prompt], results: [], warnings: [`Gemini: ${error instanceof Error ? error.message : String(error)}`] };
    }
  }
}
