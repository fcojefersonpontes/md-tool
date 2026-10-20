/**
 * Everything that drives a headless browser through puppeteer. Bundled on its
 * own (dist/browser.js) and required on first use, so activation stays light.
 */
export { renderPdf, type RenderPdfOptions } from '../pdf/renderPdf';
export { rasterize, type RasterImage, type RasterJob, type RasterizeOptions } from './rasterize';
