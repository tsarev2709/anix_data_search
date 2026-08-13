import "dotenv/config";
import { requestJson } from "./http.js";

const baseUrl = process.env.AMO_BASE_URL?.replace(/\/$/, "");
const accessToken = process.env.AMO_ACCESS_TOKEN;
if (!baseUrl || !accessToken) throw new Error("Set AMO_BASE_URL and AMO_ACCESS_TOKEN");

const http = { timeoutMs: 15_000, retries: 2, userAgent: "AnixContactResearchBot/0.1 (+https://studio.anix-ai.pro)" };
const headers = { authorization: `Bearer ${accessToken}`, accept: "application/json" };

const get = <T>(path: string) => requestJson<T>(`${baseUrl}${path}`, { method: "GET", headers }, http);

const [pipelines, contactFields, companyFields, taskTypes] = await Promise.all([
  get("/api/v4/leads/pipelines"),
  get("/api/v4/contacts/custom_fields"),
  get("/api/v4/companies/custom_fields"),
  get("/api/v4/tasks/types"),
]);

console.log(JSON.stringify({ pipelines, contactFields, companyFields, taskTypes }, null, 2));
