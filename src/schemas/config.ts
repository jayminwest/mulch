export interface MulchConfig {
  version: string;
  domains: string[];
  governance: {
    max_entries: number;
    warn_entries: number;
    hard_limit: number;
  };
  classification_defaults: {
    shelf_life: {
      tactical: number;
      observational: number;
    };
  };
}

export const DEFAULT_CONFIG: MulchConfig = {
  version: "1",
  domains: [],
  governance: {
    max_entries: 100,
    warn_entries: 150,
    hard_limit: 200,
  },
  classification_defaults: {
    shelf_life: {
      tactical: 14,
      observational: 30,
    },
  },
};
