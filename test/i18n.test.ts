import { describe, expect, it } from "vitest";
import { resources } from "../client/resources";

type Resource = { readonly [key: string]: string | Resource };

function flatten(resource: Resource, prefix = ""): Record<string, string> {
  return Object.entries(resource).reduce<Record<string, string>>((out, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? { ...out, [path]: value } : { ...out, ...flatten(value, path) };
  }, {});
}
const placeholders = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe("translations", () => {
  const source = flatten(resources.en);

  for (const [locale, resource] of Object.entries(resources)) {
    if (locale === "en") continue;
    const target = flatten(resource);

    it(`${locale} has every English key and no extra keys`, () => {
      expect(Object.keys(target).sort()).toEqual(Object.keys(source).sort());
    });

    it(`${locale} keeps the same placeholders and has no empty strings`, () => {
      for (const [key, text] of Object.entries(target)) {
        expect(text.trim(), key).not.toBe("");
        expect(placeholders(text), key).toEqual(placeholders(source[key] ?? ""));
      }
    });
  }

  it("ships English and Spanish", () => {
    expect(Object.keys(resources).sort()).toEqual(["en", "es"]);
  });
});
