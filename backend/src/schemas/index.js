import { z } from "zod";
import { isRealDate } from "../lib/dates.js";
import { TOPIC_IDS } from "../services/triage-flow.js";

export const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
export const password = z.string().min(8, "Use a password of at least 8 characters.").max(128, "Password is too long.");
const dateStr = z.string().refine(isRealDate, "Use a real date in YYYY-MM-DD format.");
const optInt = (min, max) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? Number(v) : v), z.number().int().min(min).max(max).optional());

export const idParam = z.object({ id: z.string().uuid("Invalid id.") });
export const dateParam = z.object({ date: dateStr });

export const signupBody = z.object({ name: z.string().trim().min(1, "Enter your name.").max(100), email, password, age: optInt(1, 120) });
export const loginBody = z.object({ email, password: z.string().min(1).max(128) });
export const deleteAccountBody = z.object({ password: z.string().min(1).max(128) });

export const chatBody = z.object({
  state: z.object({
    topic: z.string().max(20).nullable().optional(),
    answers: z.record(z.string().max(40), z.string().max(200)).optional(),
    current: z.string().max(20).nullable().optional(),
  }).optional(),
  message: z.string().trim().min(1, "Type a few words about how you feel.").max(500),
  locale: z.string().max(10).optional(),
});

export const knowledgeQuery = z.object({ topic: z.enum(TOPIC_IDS).optional(), q: z.string().trim().max(100).optional() });

export const historyBody = z.object({
  date: dateStr.optional(),
  title: z.string().trim().min(1).max(120),
  urgency: z.enum(["routine", "urgent", "emergency", "unknown"]).default("routine"),
  summary: z.string().trim().max(500).optional(),
});

export const checkinBody = z.object({
  mood: z.enum(["Low", "Okay", "Good", "Great"]),
  energy: z.enum(["Tired", "Steady", "Energised"]),
  digestion: z.enum(["Heavy", "Normal", "Light"]),
  sleep: z.number().min(0).max(14),
});
export const checkinsQuery = z.object({ from: dateStr.optional(), to: dateStr.optional() });

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour).");
export const reminderCreate = z.object({ name: z.string().trim().min(1).max(120), time, active: z.boolean().optional() });
export const reminderPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  time: time.optional(),
  active: z.boolean().optional(),
  takenOn: dateStr.nullable().optional(),
}).refine((o) => Object.keys(o).length > 0, "Provide at least one field to update.");

export const profilePatch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  age: z.number().int().min(1).max(120).nullable().optional(),
}).refine((o) => Object.keys(o).length > 0, "Provide at least one field to update.");

export const calendarQuery = z.object({ from: dateStr, to: dateStr }).refine(
  (o) => o.to >= o.from && (Date.parse(o.to) - Date.parse(o.from)) / 86400000 <= 400, "Date range must be valid and at most 400 days.");
