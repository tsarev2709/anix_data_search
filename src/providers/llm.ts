import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { ContactCandidate, Evidence } from "../types.js";
import { isGenericEmail, normalizeEmail, normalizePhone, truncate, unique } from "../utils.js";

const extractedSchema = z.object({
  contacts: z.array(
    z.object({
      full_name: z.string().nullable(),
      position: z.string().nullable(),
      emails: z.array(z.string()),
      phones: z.array(z.string()),
      social_urls: z.array(z.string()),
      evidence_urls: z.array(z.string()),
    }),
  ),
});

export class LlmExtractor {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async extract(companyName: string, evidence: Evidence[], targetRoles: string[]): Promise<ContactCandidate[]> {
    const allowedUrls = new Set(evidence.map((item) => item.url));
    const sourceText = evidence.map((item) => `${item.url}\n${item.title}\n${truncate(item.snippet, 2_000)}`).join("\n\n---\n\n");
    const allowedEmails = new Set((sourceText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map(normalizeEmail));
    const allowedSocialUrls = new Set((sourceText.match(/https?:\/\/[^\s)\]>'"]+/gi) ?? []).filter((url) => /t\.me|telegram|vk\.com|linkedin|threads\.net|tenchat/i.test(url)));

    const response = await this.client.responses.parse({
      model: this.model,
      store: false,
      input: [
        {
          role: "system",
          content:
            "Ты извлекаешь только публичные деловые контакты из предоставленных источников. Ничего не угадывай: не конструируй email, имена, должности, телефоны или ссылки. Возвращай пустой массив, если данных нет. Каждый контакт обязан ссылаться на URL из контекста. Предпочитай лиц, принимающих решения, и профильные роли.",
        },
        {
          role: "user",
          content: `Компания: ${companyName}\nЦелевые роли: ${targetRoles.join(", ")}\n\nИсточники:\n${truncate(sourceText, 45_000)}`,
        },
      ],
      text: { format: zodTextFormat(extractedSchema, "public_business_contacts") },
    });

    return (response.output_parsed?.contacts ?? [])
      .map((contact): ContactCandidate | null => {
        const urls = unique(contact.evidence_urls.filter((url) => allowedUrls.has(url)));
        if (urls.length === 0) return null;
        const emails = unique(contact.emails.map(normalizeEmail).filter((email) => allowedEmails.has(email))).map((email) => ({
          value: email,
          generic: isGenericEmail(email),
          deliverability: "unknown" as const,
        }));
        const socialUrls = unique(contact.social_urls.filter((url) => allowedSocialUrls.has(url)));
        if (emails.length === 0 && socialUrls.length === 0 && contact.phones.length === 0) return null;
        return {
          fullName: contact.full_name?.trim() || null,
          position: contact.position?.trim() || null,
          emails,
          phones: unique(contact.phones.map(normalizePhone).filter(Boolean)),
          socialUrls,
          evidence: evidence.filter((item) => urls.includes(item.url)).map((item) => ({ ...item, source: "llm" as const })),
          score: 0,
          scoreReasons: [],
        };
      })
      .filter((contact): contact is ContactCandidate => Boolean(contact));
  }
}
