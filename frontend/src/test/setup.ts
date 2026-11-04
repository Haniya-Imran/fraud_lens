import "@testing-library/jest-dom/vitest";

// jsdom does not implement scrolling or matchMedia.
window.scrollTo = (() => {}) as typeof window.scrollTo;
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
