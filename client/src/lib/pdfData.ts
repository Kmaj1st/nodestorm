/**
 * The folder of the build that holds PDF.js's CMaps (`cmaps/`) and standard fonts (`standard_fonts/`), named after
 * the PDF.js version so a new version never reads a cached file of an old one. pwa/pdfjsData.ts copies them there
 * (and serves them in `vite dev`); the service worker caches them on first use instead of precaching them.
 * Plain constants only: vite.config.ts imports this file too.
 */
export const PDF_DATA_PREFIX = "pdfjs-";
export const pdfDataDir = (version: string) => `${PDF_DATA_PREFIX}${version}/`;
