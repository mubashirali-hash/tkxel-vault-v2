import React, { useState, useEffect, useRef, useId } from 'react';
import { NodeViewWrapper, NodeViewContent, NodeViewProps, ReactNodeViewRenderer } from '@tiptap/react';
import CodeBlock from '@tiptap/extension-code-block';
import { Code, Eye, Edit3, Copy, Check, AlertTriangle } from 'lucide-react';

let mermaidReady = false;

async function getMermaid() {
  const mod = await import('mermaid');
  const mermaid = mod.default;
  if (!mermaidReady) {
    const bg = typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--tk-bg').trim()
      : '';
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

export const CodeBlockComponent: React.FC<NodeViewProps> = ({
  node,
}) => {
  const language = node.attrs.language || '';
  const isMermaid = language.toLowerCase() === 'mermaid';
  const textContent = node.textContent;

  // Mermaid-specific states
  // If block is non-empty, default to rendered diagram view; if empty, open in edit mode
  const [isEditing, setIsEditing] = useState<boolean>(() => !textContent || textContent.trim().length === 0);
  const [svgHtml, setSvgHtml] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const renderSeq = useRef(0);
  const uniqueId = useId().replace(/[^a-zA-Z0-9]/g, '_');

  // Handle SVG rendering for Mermaid
  useEffect(() => {
    if (!isMermaid) return;

    const currentSeq = ++renderSeq.current;
    const source = textContent.trim();

    if (!source) {
      setSvgHtml('');
      setRenderError(null);
      return;
    }

    setIsRendering(true);

    const timer = setTimeout(async () => {
      try {
        const mermaid = await getMermaid();
        if (renderSeq.current !== currentSeq) return;

        const diagramId = `mermaid_diag_${uniqueId}_${Date.now()}`;
        const { svg } = await mermaid.render(diagramId, source);

        if (renderSeq.current === currentSeq) {
          setSvgHtml(svg);
          setRenderError(null);
          setIsRendering(false);
        }
      } catch (err: unknown) {
        if (renderSeq.current === currentSeq) {
          const msg = err instanceof Error ? err.message : String(err);
          setRenderError(msg);
          setIsRendering(false);
        }
      }
    }, isEditing ? 300 : 0);

    return () => clearTimeout(timer);
  }, [textContent, isMermaid, isEditing, uniqueId]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API restricted
    }
  };

  // ─── RENDER MERMAID DIAGRAM BLOCK ──────────────────────────────────────────
  if (isMermaid) {
    return (
      <NodeViewWrapper className="inplace-mermaid-nodeview" data-mermaid-view={isEditing ? 'edit' : 'diagram'}>
        {/* Top Control Bar */}
        <div className="inplace-mermaid__header">
          <div className="inplace-mermaid__badge">
            <Code size={13} />
            <span>Mermaid Diagram</span>
            {isRendering && <span className="inplace-mermaid__rendering-pill">Rendering…</span>}
          </div>

          <div className="inplace-mermaid__actions">
            <button
              type="button"
              className="btn btn-ghost inplace-mermaid__btn"
              onClick={handleCopyCode}
              title="Copy Mermaid source code"
            >
              {copied ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            {isEditing ? (
              <button
                type="button"
                className="btn btn-primary-blue inplace-mermaid__btn inplace-mermaid__btn-done"
                onClick={() => setIsEditing(false)}
                title="Finish editing and view clean diagram"
              >
                <Eye size={12} />
                <span>Done</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost inplace-mermaid__btn inplace-mermaid__btn-edit"
                onClick={() => setIsEditing(true)}
                title="Edit Mermaid syntax"
              >
                <Edit3 size={12} />
                <span>Edit Diagram</span>
              </button>
            )}
          </div>
        </div>

        {/* Edit Tray: Code editor + Live Preview */}
        <div
          className="inplace-mermaid__edit-tray"
          style={{ display: isEditing ? 'block' : 'none' }}
        >
          <div className="inplace-mermaid__editor-wrap">
            <pre className="inplace-mermaid__code-pre">
              <NodeViewContent as="div" className="language-mermaid" />
            </pre>
          </div>

          {renderError && (
            <div className="inplace-mermaid__error">
              <AlertTriangle size={13} />
              <span>Diagram syntax error: {renderError}</span>
            </div>
          )}

          {/* Live Preview beneath code during editing */}
          {svgHtml && !renderError && (
            <div className="inplace-mermaid__live-preview">
              <div className="inplace-mermaid__live-preview-label">Live Preview:</div>
              <div
                className="inplace-mermaid__svg-canvas"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
            </div>
          )}
        </div>

        {/* Clean Diagram View (Visible when not editing) */}
        {!isEditing && (
          <div
            className="inplace-mermaid__diagram-surface"
            onClick={() => setIsEditing(true)}
            title="Click to edit diagram"
          >
            {svgHtml ? (
              <div
                className="inplace-mermaid__svg-canvas"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
            ) : renderError ? (
              <div className="inplace-mermaid__error-fallback">
                <AlertTriangle size={15} color="#dc2626" />
                <div className="inplace-mermaid__error-text">
                  <strong>Diagram rendering failed</strong>
                  <p>{renderError}</p>
                  <button
                    type="button"
                    className="btn btn-secondary-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsEditing(true);
                    }}
                  >
                    Edit syntax
                  </button>
                </div>
              </div>
            ) : (
              <div className="inplace-mermaid__empty">
                <em>Empty diagram. Click to edit.</em>
              </div>
            )}
          </div>
        )}

        {/* Keep NodeViewContent mounted when not editing so ProseMirror maintains document tree */}
        <div
          style={{
            display: isEditing ? 'none' : 'block',
            position: 'absolute',
            opacity: 0,
            pointerEvents: 'none',
            height: 0,
            overflow: 'hidden',
          }}
          aria-hidden="true"
        >
          <pre>
            <NodeViewContent as="div" />
          </pre>
        </div>
      </NodeViewWrapper>
    );
  }

  // ─── RENDER STANDARD CODE & ASCII ARCHITECTURE BLOCK ────────────────────────
  return (
    <NodeViewWrapper className="inplace-code-nodeview">
      <div className="inplace-code__header">
        <span className="inplace-code__lang">
          {language ? language.toUpperCase() : 'TEXT / ASCII'}
        </span>
        <button
          type="button"
          className="inplace-code__copy-btn"
          onClick={handleCopyCode}
          title="Copy code"
        >
          {copied ? <Check size={12} color="#4ade80" /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="inplace-code__pre">
        <NodeViewContent as="div" className={language ? `language-${language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  );
};

export const CustomCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockComponent);
  },
});

