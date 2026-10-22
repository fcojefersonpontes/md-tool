/**
 * The exporters' heavy dependencies (pdfkit, MathJax, resvg). Bundled on its own
 * (dist/exporter.js) and loaded on the first export, so activation stays fast.
 */
export { resolveFonts, systemFontIndex } from '../../core/fonts/fontIndex';
export { renderMath } from '../../core/graphics/math';
export { bitmapSvg, initRaster, svgSize, svgToPng } from '../../core/graphics/raster';
export { renderPdf } from '../../core/pdf/PdfRenderer';
