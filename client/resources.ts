/** UI strings. English is the source locale; every key must exist in every other locale (see test/i18n.test.ts). */
export const resources = {
  en: {
    title: "Zelqio Flow",
    status: {
      loading: "Loading…",
      unavailable: "Status unavailable",
      version: "Version {{version}}",
      level: {
        foundation: "Foundation",
        advanced: "Advanced Orchestration",
        complete: "Complete MVP",
      },
      effects: {
        on: "Effects enabled",
        off: "Effects disabled",
      },
    },
  },
  es: {
    title: "Zelqio Flow",
    status: {
      loading: "Cargando…",
      unavailable: "Estado no disponible",
      version: "Versión {{version}}",
      level: {
        foundation: "Foundation",
        advanced: "Orquestación avanzada",
        complete: "MVP completo",
      },
      effects: {
        on: "Efectos activados",
        off: "Efectos desactivados",
      },
    },
  },
} as const;
