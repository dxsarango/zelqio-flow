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
    providers: {
      title: "Providers",
      loading: "Reading providers…",
      unavailable: "Providers unavailable",
      empty: "No providers reported",
      summary_one: "{{status}} · {{count}} model",
      summary_other: "{{status}} · {{count}} models",
      status: {
        ready: "Ready",
        loading: "Loading",
        error: "Error",
        unavailable: "Unavailable",
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
    providers: {
      title: "Proveedores",
      loading: "Leyendo proveedores…",
      unavailable: "Proveedores no disponibles",
      empty: "No se informaron proveedores",
      summary_one: "{{status}} · {{count}} modelo",
      summary_other: "{{status}} · {{count}} modelos",
      status: {
        ready: "Listo",
        loading: "Cargando",
        error: "Error",
        unavailable: "No disponible",
      },
    },
  },
} as const;
