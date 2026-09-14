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
    <div className="mb-3 rounded-lg border border-purple-200 bg-gradient-to-r from-purple-50/90 via-indigo-50/80 to-blue-50/90 p-2.5 text-xs shadow-sm transition-all animate-in fade-in slide-in-from-top-1 dark:border-purple-900/50 dark:from-purple-950/40 dark:via-indigo-950/30 dark:to-blue-950/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-600 text-white shadow-sm">
            <Sparkles className="h-3.5 w-3.5 animate-pulse" />
          </div>
          <div>
            <span className="font-semibold text-purple-900 dark:text-purple-200">
              AI Smart Linker:
            </span>{' '}
            <span className="text-gray-700 dark:text-gray-300">
              Found {suggestions.length} potential {suggestions.length === 1 ? 'connection' : 'connections'} for this note
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onAcceptAll}
            disabled={isProcessing}
            className="inline-flex items-center gap-1 rounded bg-purple-600 px-2.5 py-1 font-medium text-white shadow-sm hover:bg-purple-700 active:scale-95 disabled:opacity-50 transition-colors"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Accept All
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center rounded p-1 text-gray-400 hover:bg-black/5 hover:text-gray-600 dark:hover:bg-white/10 dark:hover:text-gray-200 transition-colors"
            title="Dismiss suggestions"
            aria-label="Dismiss suggestions"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 pt-1 border-t border-purple-100 dark:border-purple-900/30">
        {suggestions.slice(0, 4).map((sug, idx) => (
          <div
            key={idx}
            className="group inline-flex items-center gap-1.5 rounded-full border border-purple-200/80 bg-white/90 px-2.5 py-0.5 text-xs text-purple-900 shadow-2xs hover:border-purple-300 dark:border-purple-800 dark:bg-gray-800/90 dark:text-purple-200 transition-colors"
          >
            <Link2 className="h-3 w-3 text-purple-500" />
            <span className="font-medium">[[{sug.targetTitle}]]</span>
            <span className="text-[10px] text-purple-600/80 dark:text-purple-400">
              {Math.round(sug.confidence * 100)}%
            </span>
            <button
              type="button"
              onClick={() => onAccept(sug)}
              disabled={isProcessing}
              className="ml-0.5 rounded-full p-0.5 text-purple-600 hover:bg-purple-100 hover:text-purple-800 dark:text-purple-300 dark:hover:bg-purple-900/50"
              title={`Accept link to [[${sug.targetTitle}]]`}
            >
              <Check className="h-3 w-3" />
            </button>
          </div>
        ))}
        {suggestions.length > 4 && (
          <span className="self-center text-[10px] text-gray-500">
            +{suggestions.length - 4} more
          </span>
        )}
      </div>
    </div>
  );
};
