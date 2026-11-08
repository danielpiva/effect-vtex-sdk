import type { Preparation } from "./Models.js";

export const plainText = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Evidence tagging, not a guarantee about a meal's ingredients or instructions. */
export function preparation(name: string, description: string): Preparation {
  const text = plainText(`${name}. ${description}`);
  const microwave = /micro[\s-]?ondas|microwave/i;
  const evidence = text.split(/(?<=[.!?])\s+/).filter((sentence) => microwave.test(sentence)).slice(0, 3);
  const recipe = /massa (?:para|de) lasanha|farinha|reche(?:ie|io)|(?:é só|basta) montar|confec[çc][aã]o de massas/i.test(text);
  const negative = /n[aã]o.{0,24}(?:micro[\s-]?ondas|microwave)/i.test(text);
  if (recipe) return { status: "recipe-needed", evidence };
  if (evidence.length && !negative) return { status: "microwave-ready", evidence };
  if (/air\s?fryer|forno (?:convencional|el[eé]trico)|fog[aã]o|fritar/i.test(text) || negative) {
    return { status: "other-equipment", evidence: evidence.length ? evidence : [plainText(name)] };
  }
  return { status: "unverified", evidence: [] };
}
