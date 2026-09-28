import { describe, expect, it } from "vitest";
import { classifyTelegramLead, telegramAlertText, telegramOrigin, telegramSourceKey } from "../supabase/functions/contact-search-admin/telegram-leads.js";

describe("Telegram lead triage", () => {
  it("alerts on a relevant request and creates a grounded draft", () => {
    const lead = classifyTelegramLead("Коллеги, посоветуйте подрядчика: нужен анимационный ролик для обучения сотрудников по охране труда. Срок до октября.");
    expect(lead.eligible).toBe(true);
    expect(lead.category).toBe("охрана труда и промышленность");
    expect(lead.replyDraft).toContain("видеоматериалы для обучения и охраны труда");
    expect(lead.replyDraft).not.toContain("октября");
  });

  it.each([
    "Вакансия: ищем монтажера в штат на видео",
    "Ищу работу, делаю ролики, предлагаю услуги",
    "Нужен бесплатный видеоурок для студентов",
    "Ищем специалиста по охране труда",
    "Наши услуги: анимационные ролики, скидка до конца недели",
  ])("does not notify for %s", (text) => {
    expect(classifyTelegramLead(text).eligible).toBe(false);
  });

  it("uses original channel message and author profile when available", () => {
    const origin = telegramOrigin({ message_id: 72, chat: { id: -100123, type: "supergroup" }, forward_origin: {
      type: "channel", chat: { id: -100456, username: "clients", title: "Заказы" }, message_id: 25,
      sender_user: { username: "ivan", first_name: "Иван" },
    } });
    expect(origin.url).toBe("https://t.me/clients/25");
    expect(origin.contactUrl).toBe("https://t.me/ivan");
  });

  it("keeps relay link distinct from a direct author link", () => {
    const origin = telegramOrigin({ message_id: 72, chat: { id: -100123, type: "supergroup" }, forward_origin: { type: "user", sender_user: { username: "ivan", first_name: "Иван" } } });
    expect(origin.url).toBe("https://t.me/c/123/72");
    expect(origin.contactUrl).toBe("https://t.me/ivan");
    expect(telegramAlertText({ category: "видео", author: "Иван", text: "нужно видео", url: origin.url, replyDraft: "Здравствуйте!" })).toContain("отправьте сами");
  });

  it("deduplicates two forwarded copies with different relay message IDs", () => {
    const original = { type: "user", date: 1780000000, sender_user: { first_name: "Иван" } };
    const first = telegramOrigin({ message_id: 72, chat: { id: -100123, type: "supergroup" }, forward_origin: original });
    const second = telegramOrigin({ message_id: 81, chat: { id: -100123, type: "supergroup" }, forward_origin: original });
    expect(telegramSourceKey(first, original.date, "Нужен ролик")).toBe(telegramSourceKey(second, original.date, "Нужен ролик"));
  });
});
