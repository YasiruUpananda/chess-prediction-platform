import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export default function PdfDocumentView({ file, onLoadSuccess, onLoadError, pageNumber, width, geometryReady, safe }) {
  return <Document file={file} onLoadSuccess={onLoadSuccess} onLoadError={onLoadError}
    loading={<div className="reader-placeholder">Opening your PDF…</div>}>
    {geometryReady ? safe ? <Page pageNumber={pageNumber} width={width} devicePixelRatio={Math.min(2, window.devicePixelRatio || 1)} renderAnnotationLayer renderTextLayer />
      : <p className="reader-error">Page dimensions exceed the rendering limit.</p>
      : <div className="reader-placeholder">Checking page dimensions…</div>}
  </Document>;
}
