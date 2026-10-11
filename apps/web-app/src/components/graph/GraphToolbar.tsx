import React, { useState, useRef, useEffect } from 'react';
import { Search, ZoomIn, ZoomOut, RotateCcw, Link2, Focus, Globe, Network, Settings2, SlidersHorizontal } from 'lucide-react';
import { Button, IconButton } from '../ui/index.js';

export interface GraphToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedType: string;
  onTypeSelect: (type: string) => void;
  selectedTag?: string;
  onTagSelect?: (tag: string) => void;
  availableTags?: string[];
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFitSelection?: () => void;
  availableCategories?: string[];
  isConnecting?: boolean;
  onToggleConnect?: () => void;
  scope?: 'local' | 'all';
  onScopeChange?: (scope: 'local' | 'all') => void;
  localScopeAvailable?: boolean;
  resultCount?: number;
  totalCount?: number;
  compact?: boolean;
  viewMode?: '2d' | '3d';
  onViewModeChange?: (mode: '2d' | '3d') => void;
  hideOrphans?: boolean;
  onToggleHideOrphans?: () => void;
  autoRotate?: boolean;
  onToggleAutoRotate?: () => void;
  labelDensity?: 'hubs' | 'all' | 'hover';
  onLabelDensityChange?: (density: 'hubs' | 'all' | 'hover') => void;
}

/** Closes a popover when the user clicks anywhere outside it. */
function useDismissOnOutsideClick(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [open]);
  return ref;
}

/**
 * Graph controls. The bar holds only what is used constantly: find a note and choose the scope.
 * Filters and display options open from two buttons, and the zoom controls sit at the edge of
 * the canvas, next to what they act on.
 */
export const GraphToolbar: React.FC<GraphToolbarProps> = ({
  searchQuery, onSearchChange, selectedType, onTypeSelect, selectedTag = 'all', onTagSelect, availableTags = [], onZoomIn, onZoomOut, onReset,
  onFitSelection, availableCategories = [], isConnecting = false, onToggleConnect,
  scope = 'all', onScopeChange, localScopeAvailable = false, resultCount = 0, totalCount = 0,
  compact = false, viewMode = '2d', onViewModeChange, hideOrphans = false, onToggleHideOrphans,
  autoRotate = false, onToggleAutoRotate, labelDensity = 'hubs', onLabelDensityChange,
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const settingsRef = useDismissOnOutsideClick(showSettings, () => setShowSettings(false));
  const filtersRef = useDismissOnOutsideClick(showFilters, () => setShowFilters(false));

  if (compact) return null;

  const activeFilters = (selectedType !== 'all' ? 1 : 0) + (selectedTag !== 'all' ? 1 : 0);

  return (
    <>
      <div className="graph-toolbar" aria-label="Graph controls">
        <div className="graph-toolbar__primary">
          <label className="graph-search">
            <Search size={15} aria-hidden="true" />
            <input type="search" aria-label="Find a note in the graph" placeholder="Find a note…" value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} />
          </label>
          {onScopeChange && (
            <div className="graph-scope" role="group" aria-label="Graph scope">
              <button type="button" aria-pressed={scope === 'local'} disabled={!localScopeAvailable} onClick={() => onScopeChange('local')}>Local neighborhood</button>
              <button type="button" aria-pressed={scope === 'all'} onClick={() => onScopeChange('all')}>Entire vault</button>
            </div>
          )}
          <span className="graph-toolbar__count" aria-live="polite">{resultCount} of {totalCount} notes</span>
        </div>

        <div className="graph-toolbar__actions">
          {isConnecting && onToggleConnect && (
            <Button variant="primary" size="sm" leadingIcon={<Link2 size={15} />} onClick={onToggleConnect}>Cancel linking</Button>
          )}

          {/* Filters */}
          <div style={{ position: 'relative' }} ref={filtersRef}>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<SlidersHorizontal size={15} />}
              aria-haspopup="dialog"
              aria-expanded={showFilters}
              onClick={() => setShowFilters(!showFilters)}
            >
              {activeFilters > 0 ? `Filters (${activeFilters})` : 'Filters'}
            </Button>
            {showFilters && (
              <div className="graph-settings-popover" role="dialog" aria-label="Graph filters">
                <div className="graph-settings-body">
                  <label className="graph-setting-col">
                    <span>Type</span>
                    <select className="graph-popover-select" value={selectedType} onChange={(event) => onTypeSelect(event.target.value)}>
                      <option value="all">All types</option>
                      {availableCategories.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </label>
                  {onTagSelect && (
                    <label className="graph-setting-col">
                      <span>Tag</span>
                      <select className="graph-popover-select" value={selectedTag} disabled={availableTags.length === 0} onChange={(event) => onTagSelect(event.target.value)}>
                        <option value="all">All tags</option>
                        {availableTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                      </select>
                    </label>
                  )}
                  {activeFilters > 0 && (
                    <button type="button" className="graph-popover-link" onClick={() => { onTypeSelect('all'); onTagSelect?.('all'); }}>
                      Clear filters
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* View and display options */}
          <div style={{ position: 'relative' }} ref={settingsRef}>
            <IconButton
              label="Graph display settings"
              icon={<Settings2 size={16} />}
              aria-haspopup="dialog"
              aria-expanded={showSettings}
              onClick={() => setShowSettings(!showSettings)}
            />
            {showSettings && (
              <div className="graph-settings-popover" role="dialog" aria-label="Graph settings">
                <div className="graph-settings-body">
                  {onViewModeChange && (
                    <div className="graph-setting-col">
                      <span>View</span>
                      <div className="graph-mode-toggle" role="group" aria-label="Visualization mode">
                        <button
                          type="button"
                          className={`graph-mode-toggle__btn ${viewMode === '2d' ? 'active' : ''}`}
                          onClick={() => onViewModeChange('2d')}
                          aria-pressed={viewMode === '2d'}
                          title="Flat network diagram"
                        >
                          <Network size={14} />
                          <span>2D Flat</span>
                        </button>
                        <button
                          type="button"
                          className={`graph-mode-toggle__btn ${viewMode === '3d' ? 'active' : ''}`}
                          onClick={() => onViewModeChange('3d')}
                          aria-pressed={viewMode === '3d'}
                          title="Orbital globe"
                        >
                          <Globe size={14} />
                          <span>3D Globe</span>
                        </button>
                      </div>
                    </div>
                  )}
                  {onToggleConnect && !isConnecting && (
                    <Button
                      variant="secondary"
                      size="sm"
                      leadingIcon={<Link2 size={15} />}
                      onClick={() => { setShowSettings(false); onToggleConnect(); }}
                    >
                      Connect notes
                    </Button>
                  )}
                  {onToggleHideOrphans && (
                    <label className="graph-setting-row">
                      <span>Hide orphan notes</span>
                      <input
                        type="checkbox"
                        checked={hideOrphans}
                        onChange={onToggleHideOrphans}
                      />
                    </label>
                  )}
                  {viewMode === '3d' && onToggleAutoRotate && (
                    <label className="graph-setting-row">
                      <span>Auto-spin globe</span>
                      <input
                        type="checkbox"
                        checked={autoRotate}
                        onChange={onToggleAutoRotate}
                      />
                    </label>
                  )}
                  {onLabelDensityChange && (
                    <div className="graph-setting-col">
                      <span>Label Density</span>
                      <div className="graph-density-options">
                        <button
                          type="button"
                          className={labelDensity === 'hubs' ? 'active' : ''}
                          onClick={() => onLabelDensityChange('hubs')}
                          title="Show labels for key connected notes only"
                        >
                          Hubs
                        </button>
                        <button
                          type="button"
                          className={labelDensity === 'all' ? 'active' : ''}
                          onClick={() => onLabelDensityChange('all')}
                          title="Show all note labels"
                        >
                          All
                        </button>
                        <button
                          type="button"
                          className={labelDensity === 'hover' ? 'active' : ''}
                          onClick={() => onLabelDensityChange('hover')}
                          title="Only show labels on hover"
                        >
                          On Hover
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Zoom controls live on the canvas, at its edge */}
      <div className="graph-zoom-controls" role="group" aria-label="Zoom">
        <IconButton label="Zoom in" icon={<ZoomIn size={17} />} onClick={onZoomIn} />
        <IconButton label="Zoom out" icon={<ZoomOut size={17} />} onClick={onZoomOut} />
        <IconButton label="Fit selected note" icon={<Focus size={17} />} disabled={!onFitSelection} onClick={onFitSelection} />
        <IconButton label="Reset graph view" icon={<RotateCcw size={16} />} onClick={onReset} />
      </div>
    </>
  );
};
