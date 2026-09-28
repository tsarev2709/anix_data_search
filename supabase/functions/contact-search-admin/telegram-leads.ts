export type TelegramUser = { id?: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
export type TelegramChat = { id: number; type?: string; title?: string; username?: string };
export type TelegramMessage = {
  message_id: number;
  date?: number;
  text?: string;
  caption?: string;
  chat: TelegramChat;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  forward_origin?: {
    type?: string;
    date?: number;
    message_id?: number;
    sender_user?: TelegramUser;
    sender_user_name?: string;
    chat?: TelegramChat;
  };
};

const SERVICES: Array<{ category: string; match: RegExp; description: string; subject: string }> = [
  { category: "охрана труда и промышленность", match: /охран[аеуы] труда|техник[аи] безопасности|промышленн|инструктаж|hse|тб\b/i, description: "видеоматериалы для обучения и охраны труда", subject: "видеоматериалы по охране труда" },
  { category: "фарма и медицина", match: /фарм|лекарств|медицин|врач|пациент|механизм[а-я ]*действия препарата/i, description: "медицинское и фармацевтическое видео", subject: "видео для медицинской задачи" },
  { category: "обучающее видео", match: /обучающ|онбординг|электронн[а-я ]*курс|видео[ -]?урок|объясняющ/i, description: "обучающие ролики для команд и клиентов", subject: "обучающее видео" },
  { category: "HR и бренд работодателя", match: /бренд работодател|hr[ -]?видео|корпоративн[а-я ]*коммуникац|видео[ -]?для сотрудников/i, description: "видео для HR и внутренних коммуникаций", subject: "HR-видео" },
  { category: "анимация и инфографика", match: /анимац|моушн|motion|инфограф|3d[ -]?ролик|2d[ -]?ролик/i, description: "анимацию и объясняющие ролики", subject: "анимационный ролик" },
  { category: "видеоконтент для бизнеса", match: /видео|ролик|видеопродакшн|видеопроизводств|корпоративн[а-я ]*фильм|съ[её]мк|монтаж|промо|видеокейс|вебинар/i, description: "видеоконтент под задачи бизнеса", subject: "видео" },
];
const REQUEST = /ищем|ищу|нужен|нужна|нужны|требуется|посоветуйте|порекомендуйте|кто (?:может|сделает|снимет|возьм[её]тся)|где заказать|хотим заказать|планируем заказать|заказать|тендер|закупк/i;
const EXCLUDE = /ваканси|резюме|ищу работу|в штат|на работу|стаж[её]р|зарплат|бесплатн|ищу заказ|предлагаем услуги|наши услуги|подпишитесь|скидк/i;
const DELIVERABLE = /видео|ролик|видеопродакшн|видеопроизводств|видеокейс|видео[ -]?курс|видео[ -]?урок|анимац|моушн|motion|съ[её]мк|снять|монтаж|инфограф|3d[ -]?ролик|2d[ -]?ролик|корпоративн[а-я ]*фильм/i;

export function classifyTelegramLead(text: string): {
  category: string;
  intent: string;
  fit: string[];
  eligible: boolean;
  replyDraft: string | null;
  reasons: string[];
} {
  const normalized = text.toLowerCase();
  const matching = SERVICES.filter((service) => service.match.test(normalized));
  const request = REQUEST.test(normalized);
  const excluded = EXCLUDE.test(normalized);
  const deliverable = DELIVERABLE.test(normalized);
  const category = matching[0]?.category ?? "видеоконтент для бизнеса";
  const intent = /тендер|закупк/.test(normalized) ? "tender"
    : /посоветуйте|порекомендуйте/.test(normalized) ? "recommendation"
    : request ? "vendor_search" : "market_signal";
  const eligible = matching.length > 0 && request && deliverable && !excluded;
  const reasons = [
    ...(matching.length ? ["Связано с услугами Anix"] : ["Нет признака релевантной услуги"]),
    ...(request ? ["Есть явный запрос"] : ["Нет явного запроса на подрядчика"]),
    ...(!deliverable ? ["Нет запроса на видеоматериал"] : []),
    ...(excluded ? ["Похоже на вакансию, саморекламу или некоммерческий запрос"] : []),
  ];
  const service = matching[0];
  const replyDraft = eligible && service
    ? `Здравствуйте! Увидел ваш запрос про ${service.subject}. Мы в Anix делаем ${service.description} для бизнеса. Могу предложить несколько форматов и ориентир по бюджету. Подскажите, какая основная задача, срок и где планируете использовать материал?`
    : null;
  return { category, intent, fit: matching.map((item) => item.category), eligible, replyDraft, reasons };
}

export function telegramOrigin(message: TelegramMessage): { author: string | null; url: string; contactUrl: string | null; direct: boolean } {
  const origin = message.forward_origin;
  const user = origin?.sender_user;
  const chat = origin?.chat;
  const author = user
    ? [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || (user.username ? `@${user.username}` : null)
    : origin?.sender_user_name ?? chat?.title ?? null;
  const originalUrl = chat?.username && origin?.message_id
    ? `https://t.me/${chat.username}/${origin.message_id}` : null;
  const content = `${message.text ?? ""} ${message.caption ?? ""}`;
  const linkedUrl = content.match(/https?:\/\/(?:t\.me|telegram\.me)\/[a-zA-Z0-9_+/-]+/i)?.[0] ?? null;
  const contactUrl = user?.username ? `https://t.me/${user.username}` : null;
  const relayChat = String(message.chat.id).replace(/^-100/, "");
  const relayUrl = message.chat.type === "supergroup"
    ? `https://t.me/c/${relayChat}/${message.message_id}` : "https://t.me";
  return { author, url: originalUrl ?? linkedUrl ?? relayUrl, contactUrl, direct: Boolean(originalUrl || linkedUrl || contactUrl) };
}

export function telegramAlertText(input: { category: string; author: string | null; text: string; url: string; replyDraft: string }): string {
  return [
    `🎯 Заявка: ${input.category}`,
    input.author ? `Автор: ${input.author}` : "Автор не указан",
    `Сообщение: ${input.text.replace(/\s+/g, " ").slice(0, 800)}`,
    `Источник: ${input.url}`,
    "",
    "Черновик ответа (отправьте сами):",
    input.replyDraft,
  ].join("\n").slice(0, 3900);
}

export function telegramSourceKey(origin: ReturnType<typeof telegramOrigin>, originalDate: number | undefined, text: string): string {
  if (origin.direct && origin.url !== "https://t.me" && !origin.url.includes("/c/")) return origin.url;
  return `${origin.author ?? "unknown"}|${originalDate ?? ""}|${text.replace(/\s+/g, " ").trim().slice(0, 500)}`;
}
