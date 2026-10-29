/**
 * MarkdownPreview.tsx
 *
 * Renders a raw markdown string as sanitized HTML, then runs mermaid.js
 * on any ```mermaid code blocks to convert them into SVG diagrams.
 *
 * Used by MarkdownEditor when isPreview === true.
 *
 * Pipeline:
 *   markdown string
 *     → marked (markdown → HTML)
 *     → DOMPurify (sanitize XSS)
 *     → dangerouslySetInnerHTML (inject into DOM)
 *     → mermaid.run() (convert .language-mermaid <code> → SVG)
 */

import React, { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// ─── Mermaid lazy initialiser ─────────────────────────────────────────────────

let mermaidReady = false;

async function getMermaid() {
  const mod = await import('mermaid');
  const mermaid = mod.default;
  if (!mermaidReady) {
    const bg = getComputedStyle(document.documentElement)
      .getPropertyValue('--tk-bg')
      .trim();
    const isDark = bg.startsWith('#0') || bg.startsWith('#1') || bg.startsWith('#2');
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'antiscript',
      fontFamily: 'Inter, system-ui, sans-serif',
      flowchart: {
        htmlLabels: true,
        useMaxWidth: true,
      },
    });
    mermaidReady = true;
  }
  return mermaid;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface MarkdownPreviewProps {
  content: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState('');
  const [renderingDiagrams, setRenderingDiagrams] = useState(false);

  // Step 1: Convert markdown → sanitized HTML whenever content changes
  useEffect(() => {
    const rawHtml = marked.parse(content, { async: false }) as string;
    const clean = DOMPurify.sanitize(rawHtml, {
      // Allow safe SVG elements for preview (excluding foreignObject)
      ADD_TAGS: ['svg', 'use', 'path', 'polygon', 'polyline', 'line', 'rect', 'circle', 'ellipse', 'g', 'defs', 'marker', 'text', 'tspan'],
      ADD_ATTR: ['viewBox', 'xmlns', 'xlink:href', 'href', 'marker-end', 'marker-start', 'd', 'points', 'transform', 'style', 'class', 'id', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'font-size', 'text-anchor', 'dominant-baseline', 'aria-label', 'role'],
    });
    setHtml(clean);
  }, [content]);

  // Step 2: After HTML is injected, find all mermaid code blocks and render them
  useEffect(() => {
    if (!html || !containerRef.current) return;

    const container = containerRef.current;

    // Find all <code class="language-mermaid"> elements inside <pre> blocks
    const codeEls = Array.from(
      container.querySelectorAll<HTMLElement>('pre code.language-mermaid')
    );

    if (codeEls.length === 0) return;

    setRenderingDiagrams(true);

    getMermaid()
      .then((mermaid) => {
        const renderPromises = codeEls.map(async (codeEl, idx) => {
          const pre = codeEl.parentElement;
          if (!pre) return;

          const source = codeEl.textContent ?? '';
          const id = `mermaid-preview-${Date.now()}-${idx}`;

          // Create a wrapper div to hold the rendered SVG
          const wrapper = document.createElement('div');
          wrapper.className = 'markdown-preview__mermaid';
          wrapper.setAttribute('data-mermaid-id', id);

          try {
            const { svg } = await mermaid.render(id, source);
            // Inject SVG directly. Mermaid with securityLevel: 'antiscript'
            // internally uses DOMPurify while preserving <foreignObject> labels
            wrapper.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            wrapper.className = 'markdown-preview__mermaid-error';
            wrapper.innerHTML = `
              <span class="markdown-preview__mermaid-error-label">⚠ Mermaid error</span>
              <pre class="markdown-preview__mermaid-error-msg">${DOMPurify.sanitize(msg)}</pre>
              <pre class="markdown-preview__mermaid-error-src">${DOMPurify.sanitize(source)}</pre>
            `;
          }

          // Replace the <pre><code> block with the rendered SVG wrapper
          pre.replaceWith(wrapper);
        });

        return Promise.allSettled(renderPromises);
      })
      .finally(() => setRenderingDiagrams(false));
  }, [html]);

  return (
    <div className="markdown-preview">
      {renderingDiagrams && (
        <div className="markdown-preview__status">
          <span className="markdown-preview__status-dot" />
          Rendering diagrams…
        </div>
      )}
      <div
        ref={containerRef}
        className="markdown-preview__body"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
};
