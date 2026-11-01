/** Web is a dev/test surface: localStorage, not secure storage (contract 06). */
export const secrets = {
  get: async (key: string) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: async (key: string, value: string) => window.localStorage.setItem(key, value),
  remove: async (key: string) => window.localStorage.removeItem(key),
};
