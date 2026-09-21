import React from 'react';
import { Sparkles, Check, CheckCheck, X, Link2 } from 'lucide-react';
import { SuggestedLink } from '../../features/notes-ai/types.js';

interface SmartLinkBannerProps {
  suggestions: SuggestedLink[];
  onAccept: (suggestion: SuggestedLink) => void;
  onAcceptAll: () => void;
  onDismiss: () => void;
  isProcessing?: boolean;
}

export const SmartLinkBanner: React.FC<SmartLinkBannerProps> = ({
  suggestions,
  onAccept,
  onAcceptAll,
  onDismiss,
  isProcessing = false,
}) => {
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="smart-link-banner">
      <div className="smart-link-banner__header">
        <div className="smart-link-banner__lead">
          <div className="smart-link-banner__icon">
            <Sparkles size={14} />
          </div>
          <div>
            <span className="smart-link-banner__title">
              AI Smart Linker:
            </span>
            <span className="smart-link-banner__count">
              Found {suggestions.length} potential {suggestions.length === 1 ? 'connection' : 'connections'} for this note
            </span>
          </div>
        </div>

        <div className="smart-link-banner__actions">
          <button
            type="button"
            onClick={onAcceptAll}
            disabled={isProcessing}
            className="smart-link-banner__btn-accept-all"
          >
            <CheckCheck size={14} />
            Accept All
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="smart-link-banner__btn-dismiss"
            title="Dismiss suggestions"
            aria-label="Dismiss suggestions"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="smart-link-banner__chips">
        {suggestions.slice(0, 4).map((sug, idx) => (
          <div key={idx} className="smart-link-banner__chip">
            <Link2 size={13} style={{ color: '#9333ea', flexShrink: 0 }} />
            <span className="smart-link-banner__chip-title">[[{sug.targetTitle}]]</span>
            <span className="smart-link-banner__chip-pct">
              {Math.round(sug.confidence * 100)}%
            </span>
            <button
              type="button"
              onClick={() => onAccept(sug)}
              disabled={isProcessing}
              className="smart-link-banner__chip-btn"
              title={`Accept link to [[${sug.targetTitle}]]`}
            >
              <Check size={12} />
            </button>
          </div>
        ))}
        {suggestions.length > 4 && (
          <span className="smart-link-banner__more">
            +{suggestions.length - 4} more
          </span>
        )}
      </div>
    </div>
  );
};
