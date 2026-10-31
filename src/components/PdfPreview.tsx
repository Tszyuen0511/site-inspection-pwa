import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerURL from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { errorMessage } from "../domain";
GlobalWorkerOptions.workerSrc = workerURL;
function PdfPage({
  document,
  pageNumber,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
}) {
  const wrapper = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false),
    [width, setWidth] = useState(700),
    [rendered, setRendered] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const el = wrapper.current!;
    const resize = new ResizeObserver((entries) =>
      setWidth(Math.max(200, entries[0].contentRect.width)),
    );
    resize.observe(el);
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return () => resize.disconnect();
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => {
      resize.disconnect();
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    setRendered(false);
    setError("");
    void (async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled) return;
        const native = page.getViewport({ scale: 1 });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({
          scale: (width / native.width) * ratio,
        });
        const target = canvas.current!;
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        task = page.render({ canvas: target, viewport, background: "#ffffff" });
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch (error) {
        if (!cancelled) setError(errorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, width, document, pageNumber]);
  return (
    <div
      ref={wrapper}
      className="pdf-page"
      aria-label={`Report page ${pageNumber}`}
    >
      <canvas
        ref={canvas}
        data-rendered={rendered}
        aria-label={`Rendered PDF page ${pageNumber}`}
      />
      {!rendered && !error && (
        <span className="pdf-page-loading">Page {pageNumber}</span>
      )}
      {error && (
        <p className="pdf-render-error" role="alert">
          Preview unavailable: {error}. Use Open PDF or Download PDF.
        </p>
      )}
    </div>
  );
}
export function PdfPreview({
  blob,
  maxPages,
}: {
  blob: Blob;
  maxPages?: number;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy>(),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    setDocument(undefined);
    setError("");
    void (async () => {
      try {
        const task = getDocument({
          data: new Uint8Array(await blob.arrayBuffer()),
          useSystemFonts: true,
        });
        destroy = () => {
          void task.destroy();
        };
        const pdf = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        setDocument(pdf);
      } catch (error) {
        if (!cancelled) setError(errorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [blob]);
  return (
    <div
      className="pdf-pages"
      role="region"
      aria-label="Inspection PDF preview"
    >
      {error ? (
        <p className="pdf-render-error" role="alert">
          {error}. Use Open PDF or Download PDF.
        </p>
      ) : !document ? (
        <div className="empty-state">
          <span className="spinner" />
          <p>Rendering report pages…</p>
        </div>
      ) : (
        Array.from(
          {
            length: Math.min(document.numPages, maxPages ?? document.numPages),
          },
          (_, i) => <PdfPage key={i} document={document} pageNumber={i + 1} />,
        )
      )}
    </div>
  );
}
