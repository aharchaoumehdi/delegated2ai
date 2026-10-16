import { z } from "zod";
import { DOMAINS, EVIDENCE, DIFFICULTY } from "./taxonomy.mjs";

const date = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, "Use YYYY-MM-DD or YYYY-MM");

/** One published (or queued) use case. Stored as data/cases/YYYY/<added>-<slug>.json */
export const CaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(8).max(110),
    summary: z.string().min(20).max(320),
    domain: z.enum(DOMAINS),
    platform: z.string().min(1),
    model: z.string().nullable(),
    tools: z.array(z.string()).max(8),
    agent_role: z.string().min(10).max(400),
    outcome: z.string().max(240).nullable(),
    // The write-up shown on the use-case page and in "View prompt".
    what_they_did: z.string().min(40).max(900).optional(),
    how_it_went: z.string().max(800).nullable().optional(),
    worth_knowing: z.string().max(600).nullable().optional(),
    prompt: z.string().min(40).max(1500).nullable().optional(),
    evidence: z.enum(EVIDENCE),
    difficulty: z.enum(DIFFICULTY),
    tags: z.array(z.string().regex(/^[a-z0-9][a-z0-9 +.-]*$/)).min(1).max(6),
    source: z
      .object({
        url: z.string().url(),
        name: z.string().min(1),
        author: z.string().nullable(),
        published: date.nullable(),
      })
      .strict(),
    added: date,
    status: z.enum(["published", "review", "rejected"]),
    score: z.number().min(0).max(10),
    featured: z.boolean().default(false),
    curation: z
      .object({
        method: z.enum(["manual", "auto"]),
        model: z.string().nullable().optional(),
        rationale: z.string().nullable().optional(),
      })
      .strict(),
  })
  .strict();
