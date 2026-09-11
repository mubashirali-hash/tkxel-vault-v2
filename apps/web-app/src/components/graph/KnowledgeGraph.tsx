import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { Page } from '@tkxel-vault/types';
import { GraphToolbar } from './GraphToolbar.js';
import { Link2, ExternalLink, Copy, Check, X, Search, Share2 } from 'lucide-react';
import { GraphInspector } from './GraphInspector.js';

export interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  type: string;
  tags: string[];
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

export interface KnowledgeGraphProps {
  pages: Page[];
  links: Array<{ from_page_id: string; to_page_id: string }>;
  onSelectPage: (pageId: string) => void;
  onLinkPages?: (sourcePageId: string, targetPageId: string) => void;
  activePageId?: string;
  compact?: boolean;
}

export function getCategoryColor(type: string, tags?: string[]): string {
  if (tags && tags.length > 0) {
    const lowerTags = tags.map((t) => t.toLowerCase());
    if (lowerTags.some((t) => t.includes('agent'))) return '#4F46E5'; // Indigo for Agents
    if (lowerTags.some((t) => t.includes('security') || t.includes('crypto'))) return '#E11D48'; // Rose for Security
    if (lowerTags.some((t) => t.includes('architecture') || t.includes('adr') || t.includes('design'))) return '#059669'; // Emerald for Architecture
    if (lowerTags.some((t) => t.includes('integration') || t.includes('iot') || t.includes('tuya') || t.includes('home'))) return '#D97706'; // Amber for Integrations
  }

  const predefined: Record<string, string> = {
    decision: '#059669',
    meeting: '#7C3AED',
    project: '#0755E9',
    client: '#D97706',
    person: '#DB2777',
    note: '#0891B2',
  };
  const key = (type || 'note').toLowerCase();
  if (predefined[key]) return predefined[key];

  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 65%, 45%)`;
}

export function humanizeNodeTitle(title: string): string {
  const readable = title.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : 'Untitled note';
}

export function getTwoHopPageIds(
  focalPageId: string,
  links: Array<{ from_page_id: string; to_page_id: string }>
): Set<string> {
  const ids = new Set<string>([focalPageId]);
  links.forEach((link) => {
    if (link.from_page_id === focalPageId) ids.add(link.to_page_id);
    if (link.to_page_id === focalPageId) ids.add(link.from_page_id);
  });
  const oneHop = new Set(ids);
  links.forEach((link) => {
    if (oneHop.has(link.from_page_id)) ids.add(link.to_page_id);
    if (oneHop.has(link.to_page_id)) ids.add(link.from_page_id);
  });
  return ids;
}

interface ContextMenuState {
  node: GraphNode;
  x: number;
  y: number;
}

interface Node3DState {
  id: string;
  title: string;
  type: string;
  tags: string[];
  x0: number;
  y0: number;
  z0: number;
  x2: number;
  y2: number;
  z2: number;
  screenX: number;
  screenY: number;
  scale: number;
  radius: number;
  normZ: number;
  opacity: number;
}

export const KnowledgeGraph: React.FC<KnowledgeGraphProps> = ({
  pages: allPages,
  links: allLinks,
  onSelectPage,
  onLinkPages,
  activePageId,
  compact = false,
}) => {
  const [scope, setScope] = useState<'local' | 'all'>(activePageId && !compact ? 'local' : 'all');
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [hideOrphans, setHideOrphans] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [labelDensity, setLabelDensity] = useState<'hubs' | 'all' | 'hover'>('hubs');

  const localIds = useMemo(() => activePageId ? getTwoHopPageIds(activePageId, allLinks) : new Set<string>(), [activePageId, allLinks]);
  
  // Calculate degree for orphan filtering (deduplicated)
  const allPageIds = useMemo(() => new Set(allPages.map((p) => p.id)), [allPages]);
  const linkDegreeMap = useMemo(() => {
    const deg = new Map<string, number>();
    const seen = new Set<string>();
    allLinks.forEach((l) => {
      if (allPageIds.has(l.from_page_id) && allPageIds.has(l.to_page_id)) {
        const key = `${l.from_page_id}->${l.to_page_id}`;
        if (seen.has(key)) return;
        seen.add(key);
        deg.set(l.from_page_id, (deg.get(l.from_page_id) || 0) + 1);
        deg.set(l.to_page_id, (deg.get(l.to_page_id) || 0) + 1);
      }
    });
    return deg;
  }, [allLinks, allPageIds]);

  const pages = useMemo(() => {
    let list = scope === 'local' && activePageId ? allPages.filter((page) => localIds.has(page.id)) : allPages;
    if (hideOrphans) {
      list = list.filter((p) => (linkDegreeMap.get(p.id) || 0) > 0 || p.id === activePageId);
    }
    return list;
  }, [scope, activePageId, allPages, localIds, hideOrphans, linkDegreeMap]);

  const links = useMemo(() => {
    const ids = new Set(pages.map((page) => page.id));
    const seen = new Set<string>();
    return allLinks.filter((link) => {
      if (!ids.has(link.from_page_id) || !ids.has(link.to_page_id)) return false;
      const key = `${link.from_page_id}->${link.to_page_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [allLinks, pages]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const drawRef = useRef<(() => void) | null>(null);

  // 3D Orbital State Refs
  const rotXRef = useRef<number>(0.15); // pitch
  const rotYRef = useRef<number>(0);    // yaw
  const rotVelXRef = useRef<number>(0);
  const rotVelYRef = useRef<number>(0);
  const zoom3DRef = useRef<number>(1.0);
  const isDragging3DRef = useRef<boolean>(false);
  const lastMousePos3DRef = useRef<{ x: number; y: number } | null>(null);
  const targetRotRef = useRef<{ x: number; y: number } | null>(null);
  const nodes3DRef = useRef<Node3DState[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Connecting / Linking Mode State
  const [connectingSource, setConnectingSource] = useState<GraphNode | null>(null);
  const [connectSearchQuery, setConnectSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // References to avoid restarting simulation on state changes
  const hoveredNodeRef = useRef<GraphNode | null>(null);
  const selectedNodeRef = useRef<GraphNode | null>(null);
  const searchQueryRef = useRef<string>('');
  const selectedTypeRef = useRef<string>('all');
  const connectingSourceRef = useRef<GraphNode | null>(null);
  const connectingMousePosRef = useRef<{ x: number; y: number } | null>(null);
  const viewModeRef = useRef<'2d' | '3d'>('2d');
  const autoRotateRef = useRef<boolean>(true);
  const labelDensityRef = useRef<'hubs' | 'all' | 'hover'>('hubs');

  useEffect(() => {
    viewModeRef.current = viewMode;
    if (viewMode === '3d') {
      simulationRef.current?.stop();
    } else {
      simulationRef.current?.alpha(0.2).restart();
    }
    drawRef.current?.();
  }, [viewMode]);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    labelDensityRef.current = labelDensity;
    drawRef.current?.();
  }, [labelDensity]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
    drawRef.current?.();
  }, [searchQuery]);

  useEffect(() => {
    selectedTypeRef.current = selectedType;
    drawRef.current?.();
  }, [selectedType]);

  useEffect(() => {
    selectedNodeRef.current = selectedNode;
    drawRef.current?.();
  }, [selectedNode]);

  useEffect(() => {
    connectingSourceRef.current = connectingSource;
    if (!connectingSource) {
      connectingMousePosRef.current = null;
    }
    drawRef.current?.();
  }, [connectingSource]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3000);
  }, []);

  const completeLink = useCallback(
    (sourceId: string, targetId: string) => {
      if (sourceId === targetId) return;
      if (onLinkPages) {
        onLinkPages(sourceId, targetId);
        const srcPage = pages.find((p) => p.id === sourceId);
        const tgtPage = pages.find((p) => p.id === targetId);
        showToast(`Linked "${srcPage?.title || 'Source'}" → [[${tgtPage?.title || 'Target'}]]`);
      }
      setConnectingSource(null);
      connectingSourceRef.current = null;
      connectingMousePosRef.current = null;
      drawRef.current?.();
    },
    [onLinkPages, pages, showToast]
  );

  // Setup 3D Coordinates via Fibonacci Sphere Projection
  useEffect(() => {
    const N = pages.length;
    if (N === 0) {
      nodes3DRef.current = [];
      return;
    }

    const phi = Math.PI * (3 - Math.sqrt(5)); // Golden angle ~2.399963 rad
    nodes3DRef.current = pages.map((page, index) => {
      const y0 = N === 1 ? 0 : 1 - (2 * index) / (N - 1); // -1 to +1
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y0 * y0));
      const theta = phi * index;
      const x0 = radiusAtY * Math.cos(theta);
      const z0 = radiusAtY * Math.sin(theta);

      return {
        id: page.id,
        title: page.title,
        type: page.type,
        tags: page.tags || [],
        x0,
        y0,
        z0,
        x2: x0,
        y2: y0,
        z2: z0,
        screenX: 0,
        screenY: 0,
        scale: 1,
        radius: 8,
        normZ: 1,
        opacity: 1,
      };
    });
  }, [pages]);

  // Main Canvas & Simulation Setup
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = container.clientWidth || 900;
    const height = container.clientHeight || 650;

    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Build 2D Nodes & Links
    const nodes: GraphNode[] = pages.map((p) => ({
      id: p.id,
      title: p.title,
      type: p.type,
      tags: p.tags,
    }));

    const nodeMap = new Map<string, GraphNode>();
    nodes.forEach((n) => nodeMap.set(n.id, n));

    const simLinks: GraphLink[] = links
      .filter((l) => nodeMap.has(l.from_page_id) && nodeMap.has(l.to_page_id))
      .map((l) => ({
        source: l.from_page_id,
        target: l.to_page_id,
      }));

    const degreeById = new Map<string, number>();
    simLinks.forEach((link) => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      degreeById.set(sourceId, (degreeById.get(sourceId) || 0) + 1);
      degreeById.set(targetId, (degreeById.get(targetId) || 0) + 1);
    });

    // 2D Hit Testing
    const findNodeAt2D = (gx: number, gy: number, radius = 20): GraphNode | null => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (n.x === undefined || n.y === undefined) continue;
        const dx = n.x - gx;
        const dy = n.y - gy;
        if (dx * dx + dy * dy <= radius * radius) {
          return n;
        }
      }
      return null;
    };

    // 3D Hit Testing (prioritizing front-facing nodes)
    const findNodeAt3D = (clientX: number, clientY: number): GraphNode | null => {
      const list = nodes3DRef.current;
      // Search front-to-back
      const sorted = [...list].sort((a, b) => b.normZ - a.normZ);
      for (const item of sorted) {
        if (item.normZ < -0.2) continue;
        const dx = item.screenX - clientX;
        const dy = item.screenY - clientY;
        const hitRadius = item.radius + 10;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) {
          return {
            id: item.id,
            title: item.title,
            type: item.type,
            tags: item.tags,
          };
        }
      }
      return null;
    };

    // D3 Simulation with Optimized Repulsion & Spacing (Compact & Non-cluttered)
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(simLinks)
          .id((d) => d.id)
          .distance(80)
      )
      .force('charge', d3.forceManyBody().strength((d) => {
        const deg = Math.min(8, degreeById.get((d as GraphNode).id) || 0);
        return -150 - deg * 12;
      }))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius((d) => {
        const deg = Math.min(8, degreeById.get((d as GraphNode).id) || 0);
        return Math.min(12, 6 + Math.sqrt(deg) * 2) + 14;
      }))
      .alphaDecay(0.028);

    simulationRef.current = simulation;

    // Helper: Draw Pill Badge behind Labels to prevent line collisions (High-Performance, Zero-Blur)
    const drawPillBadge = (
      text: string,
      x: number,
      y: number,
      isHighlighted: boolean,
      isHovered: boolean,
      categoryColor: string
    ) => {
      ctx.save();
      ctx.font = isHovered
        ? '700 12px "Plus Jakarta Sans", sans-serif'
        : '600 11px "Plus Jakarta Sans", sans-serif';

      const metrics = ctx.measureText(text);
      const paddingX = 7;
      const h = 18;
      const w = metrics.width + paddingX * 2 + 10;
      const rx = x;
      const ry = y - 11;

      // Soft crisp white pill background (Zero shadowBlur for 60+ FPS)
      ctx.fillStyle = isHighlighted
        ? 'rgba(255, 255, 255, 0.98)'
        : 'rgba(255, 255, 255, 0.94)';

      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(rx, ry, w, h, 9);
      } else {
        ctx.rect(rx, ry, w, h);
      }
      ctx.fill();

      // Delicate border
      ctx.lineWidth = isHovered ? 1.5 : 1;
      ctx.strokeStyle = isHovered ? '#0755E9' : '#CBD5E1';
      ctx.stroke();

      // Left color indicator dot
      ctx.beginPath();
      ctx.arc(rx + 6 + 2, ry + h / 2, 3, 0, Math.PI * 2);
      ctx.fillStyle = categoryColor;
      ctx.fill();

      // Label text
      ctx.fillStyle = isHovered ? '#0755E9' : '#0F172A';
      ctx.fillText(text, rx + 14, ry + 13);
      ctx.restore();
    };

    // Helper: Truncate long titles unless hovered/selected
    const formatTitle = (raw: string, isExpanded: boolean): string => {
      const readable = humanizeNodeTitle(raw);
      if (isExpanded || readable.length <= 22) return readable;
      return `${readable.slice(0, 20)}…`;
    };

    // 2D Draw Function
    const draw2D = () => {
      ctx.save();
      ctx.clearRect(0, 0, width, height);

      // Clean background
      ctx.fillStyle = '#FAFCFF';
      ctx.fillRect(0, 0, width, height);

      // Light dot grid
      ctx.fillStyle = '#E2E8F0';
      const t = transformRef.current;
      const dotSpacing = 28 * t.k;
      const offsetX = t.x % dotSpacing;
      const offsetY = t.y % dotSpacing;

      for (let x = offsetX; x < width; x += dotSpacing) {
        for (let y = offsetY; y < height; y += dotSpacing) {
          ctx.fillRect(x, y, 1.5, 1.5);
        }
      }

      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      const currentHovered = hoveredNodeRef.current;
      const currentSelected = selectedNodeRef.current;
      const currentQuery = searchQueryRef.current.toLowerCase();
      const currentType = selectedTypeRef.current;
      const currentDensity = labelDensityRef.current;
      const currentConnectingSrc = connectingSourceRef.current;
      const currentConnectingPos = connectingMousePosRef.current;

      const selectedNeighborIds = new Set<string>();
      const hoveredNeighborIds = new Set<string>();

      if (currentSelected) {
        simLinks.forEach((link) => {
          const source = link.source as GraphNode;
          const target = link.target as GraphNode;
          if (source.id === currentSelected.id) selectedNeighborIds.add(target.id);
          if (target.id === currentSelected.id) selectedNeighborIds.add(source.id);
        });
      }

      if (currentHovered) {
        simLinks.forEach((link) => {
          const source = link.source as GraphNode;
          const target = link.target as GraphNode;
          if (source.id === currentHovered.id) hoveredNeighborIds.add(target.id);
          if (target.id === currentHovered.id) hoveredNeighborIds.add(source.id);
        });
      }

      const isFocalActive = Boolean(currentHovered || currentSelected);

      // Draw Links
      simLinks.forEach((link) => {
        const src = link.source as GraphNode;
        const tgt = link.target as GraphNode;
        if (src.x !== undefined && src.y !== undefined && tgt.x !== undefined && tgt.y !== undefined) {
          const isConnectedToHovered =
            currentHovered && (currentHovered.id === src.id || currentHovered.id === tgt.id);
          const isConnectedToSelected =
            currentSelected && (currentSelected.id === src.id || currentSelected.id === tgt.id);

          ctx.beginPath();
          ctx.moveTo(src.x, src.y);
          ctx.lineTo(tgt.x, tgt.y);

          if (isConnectedToSelected) {
            ctx.strokeStyle = '#0755E9';
            ctx.lineWidth = 3;
            ctx.globalAlpha = 1;
          } else if (isConnectedToHovered) {
            ctx.strokeStyle = '#4F86EE';
            ctx.lineWidth = 2.2;
            ctx.globalAlpha = 1;
          } else if (isFocalActive) {
            ctx.strokeStyle = '#E2E8F0';
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.18;
          } else {
            ctx.strokeStyle = '#CBD5E1';
            ctx.lineWidth = 1.35;
            ctx.globalAlpha = 0.8;
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      });

      // Connecting Mode ray
      if (currentConnectingSrc && currentConnectingPos && currentConnectingSrc.x !== undefined && currentConnectingSrc.y !== undefined) {
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.moveTo(currentConnectingSrc.x, currentConnectingSrc.y);
        ctx.lineTo(currentConnectingPos.x, currentConnectingPos.y);
        ctx.strokeStyle = '#0755E9';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(currentConnectingPos.x, currentConnectingPos.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#0755E9';
        ctx.fill();
        ctx.restore();
      }

      // Draw Nodes
      nodes.forEach((node) => {
        if (node.x === undefined || node.y === undefined) return;

        const isMatch =
          (!currentQuery || humanizeNodeTitle(node.title).toLowerCase().includes(currentQuery)) &&
          (currentType === 'all' || node.type === currentType);

        const isHovered = currentHovered?.id === node.id;
        const isSelected = currentSelected?.id === node.id;
        const isConnectedNeighbor = selectedNeighborIds.has(node.id) || hoveredNeighborIds.has(node.id);
        const isConnectingSource = currentConnectingSrc?.id === node.id;
        const isPotentialTarget = currentConnectingSrc && !isConnectingSource && isHovered;

        const nodeDegree = degreeById.get(node.id) || 0;
        const nodeColor = getCategoryColor(node.type, node.tags);
        const degreeRadius = Math.min(14, 7 + Math.sqrt(nodeDegree) * 2);
        const baseRadius = isMatch ? degreeRadius : 5;
        const radius = isHovered || isConnectingSource || isSelected ? baseRadius + 3 : baseRadius;

        // Dimming when a focal node is active
        const isDimmed = isFocalActive && !isHovered && !isSelected && !isConnectedNeighbor;
        ctx.globalAlpha = isDimmed ? 0.16 : isMatch ? 1 : 0.35;

        // Connecting source pulse aura
        if (isConnectingSource) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 8, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(7, 85, 233, 0.25)';
          ctx.fill();
          ctx.strokeStyle = '#0755E9';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Potential target link aura
        if (isPotentialTarget) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 8, 0, 2 * Math.PI);
          ctx.strokeStyle = '#0755E9';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.restore();
        }

        // Hover outer soft ring
        if (isHovered && !isConnectingSource) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 5, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(7, 85, 233, 0.16)';
          ctx.fill();
        }

        // Main Node Circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = isMatch ? nodeColor : '#94A3B8';
        ctx.fill();

        // Node crisp white border
        ctx.lineWidth = isSelected ? 3.5 : 2;
        ctx.strokeStyle = isSelected ? '#0F172A' : '#FFFFFF';
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Smart Label Visibility (LOD)
        const isHub = nodeDegree >= 3;
        const shouldShowLabel =
          isSelected ||
          isHovered ||
          isConnectedNeighbor ||
          isConnectingSource ||
          (isMatch && (
            currentDensity === 'all'
              ? (t.k >= 0.65 || nodes.length < 80)
              : currentDensity === 'hubs'
              ? (isHub || t.k >= 1.25)
              : false
          ));

        if (shouldShowLabel && !isDimmed) {
          const title = formatTitle(node.title, isHovered || isSelected);
          drawPillBadge(title, node.x + radius + 4, node.y, isHovered || isSelected, isHovered, nodeColor);
        }
      });

      ctx.restore();
    };

    // 3D Draw Function: Interactive Planetary Globe ("Round Earth")
    const draw3D = () => {
      ctx.save();
      ctx.clearRect(0, 0, width, height);

      // Clean subtle canvas background
      ctx.fillStyle = '#FAFCFF';
      ctx.fillRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const baseR = Math.min(width, height) * 0.32;
      const R = baseR * zoom3DRef.current;
      const D = 800; // camera focal distance

      const rotX = rotXRef.current;
      const rotY = rotYRef.current;
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);

      const currentHovered = hoveredNodeRef.current;
      const currentSelected = selectedNodeRef.current;
      const currentQuery = searchQueryRef.current.toLowerCase();
      const currentType = selectedTypeRef.current;
      const currentDensity = labelDensityRef.current;

      const selectedNeighborIds = new Set<string>();
      const hoveredNeighborIds = new Set<string>();

      if (currentSelected) {
        simLinks.forEach((link) => {
          const s = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id;
          const t = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id;
          if (s === currentSelected.id) selectedNeighborIds.add(t);
          if (t === currentSelected.id) selectedNeighborIds.add(s);
        });
      }

      if (currentHovered) {
        simLinks.forEach((link) => {
          const s = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id;
          const t = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id;
          if (s === currentHovered.id) hoveredNeighborIds.add(t);
          if (t === currentHovered.id) hoveredNeighborIds.add(s);
        });
      }

      // 1. Draw Atmospheric Planetary Horizon Glow (Behind the Globe)
      const atmosHalo = ctx.createRadialGradient(cx, cy, R * 0.75, cx, cy, R * 1.15);
      atmosHalo.addColorStop(0, 'rgba(7, 85, 233, 0.05)');
      atmosHalo.addColorStop(0.7, 'rgba(7, 85, 233, 0.02)');
      atmosHalo.addColorStop(1, 'rgba(7, 85, 233, 0)');
      ctx.fillStyle = atmosHalo;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2);
      ctx.fill();

      // 2. Draw Subtle Globe Sphere Horizon Rim (Zero shadowBlur for 60+ FPS)
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // 3. Draw Rotating Latitude & Longitude Wireframe Grid (Subtle Planet Lines)
      ctx.save();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
      ctx.lineWidth = 0.75;

      [-0.45, 0, 0.45].forEach((lat) => {
        const rLat = Math.sqrt(1 - lat * lat);
        const segments = 32;
        ctx.beginPath();
        let first = true;
        for (let i = 0; i <= segments; i++) {
          const lon = (i / segments) * Math.PI * 2;
          const px0 = rLat * Math.cos(lon);
          const py0 = lat;
          const pz0 = rLat * Math.sin(lon);

          const px1 = px0 * cosY + pz0 * sinY;
          const py1 = py0;
          const pz1 = -px0 * sinY + pz0 * cosY;

          const px2 = px1;
          const py2 = py1 * cosX - pz1 * sinX;
          const pz2 = py1 * sinX + pz1 * cosX;

          if (pz2 >= -0.1) {
            const sc = D / (D - pz2 * R);
            const sx = cx + px2 * R * sc;
            const sy = cy + py2 * R * sc;
            if (first) {
              ctx.moveTo(sx, sy);
              first = false;
            } else {
              ctx.lineTo(sx, sy);
            }
          } else {
            first = true;
          }
        }
        ctx.stroke();
      });
      ctx.restore();

      // 4. Transform all 3D Nodes
      const nodes3D = nodes3DRef.current;
      const node3DMap = new Map<string, Node3DState>();

      nodes3D.forEach((n) => {
        const x1 = n.x0 * cosY + n.z0 * sinY;
        const y1 = n.y0;
        const z1 = -n.x0 * sinY + n.z0 * cosY;

        const x2 = x1;
        const y2 = y1 * cosX - z1 * sinX;
        const z2 = y1 * sinX + z1 * cosX;

        const worldZ = z2 * R;
        const sc = D / (D - worldZ);
        const screenX = cx + x2 * R * sc;
        const screenY = cy + y2 * R * sc;

        const normZ = z2;
        let opacity = 1.0;
        if (normZ > 0.05) {
          opacity = 1.0; // Sharp & visible on front
        } else if (normZ >= -0.25) {
          opacity = Math.max(0.08, (normZ + 0.25) / 0.3); // Horizon transition
        } else {
          opacity = 0.06; // Faded back ghost so front view is undisturbed
        }

        const deg = degreeById.get(n.id) || 0;
        const baseRad = Math.min(14, 7 + Math.sqrt(deg) * 2);
        const finalRad = baseRad * sc * (normZ > 0 ? 1 : 0.85);

        n.x2 = x2;
        n.y2 = y2;
        n.z2 = z2;
        n.screenX = screenX;
        n.screenY = screenY;
        n.scale = sc;
        n.radius = finalRad;
        n.normZ = normZ;
        n.opacity = opacity;

        node3DMap.set(n.id, n);
      });

      // 5. Draw 3D Curved Surface Links (Great-Circle Arcs) - Batched Single-Pass
      ctx.save();
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 1.1;
      ctx.globalAlpha = 0.65;
      ctx.beginPath();

      const highlightedArcs: Array<{ s: Node3DState; t: Node3DState; smx: number; smy: number; isSelected: boolean }> = [];

      simLinks.forEach((link) => {
        const sId = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id;
        const tId = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id;
        const s = node3DMap.get(sId);
        const t = node3DMap.get(tId);
        if (!s || !t) return;

        if (s.normZ < -0.15 && t.normZ < -0.15) return; // Hide back links to declutter

        const mx = (s.x2 + t.x2) / 2;
        const my = (s.y2 + t.y2) / 2;
        const mz = (s.z2 + t.z2) / 2;
        const mLen = Math.hypot(mx, my, mz) || 1;
        const lift = 1.08;
        const arcMidX = (mx / mLen) * lift;
        const arcMidY = (my / mLen) * lift;
        const arcMidZ = (mz / mLen) * lift;

        const arcSc = D / (D - arcMidZ * R);
        const smx = cx + arcMidX * R * arcSc;
        const smy = cy + arcMidY * R * arcSc;

        const isHoverConnected = currentHovered && (currentHovered.id === sId || currentHovered.id === tId);
        const isSelectedConnected = currentSelected && (currentSelected.id === sId || currentSelected.id === tId);

        if (isSelectedConnected || isHoverConnected) {
          highlightedArcs.push({ s, t, smx, smy, isSelected: Boolean(isSelectedConnected) });
        } else {
          ctx.moveTo(s.screenX, s.screenY);
          ctx.quadraticCurveTo(smx, smy, t.screenX, t.screenY);
        }
      });
      ctx.stroke();
      ctx.restore();

      // Highlighted active arcs in second pass
      if (highlightedArcs.length > 0) {
        highlightedArcs.forEach(({ s, t, smx, smy, isSelected }) => {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(s.screenX, s.screenY);
          ctx.quadraticCurveTo(smx, smy, t.screenX, t.screenY);
          ctx.strokeStyle = isSelected ? '#0755E9' : '#3B82F6';
          ctx.lineWidth = isSelected ? 2.8 : 2.0;
          ctx.globalAlpha = 0.95;
          ctx.stroke();
          ctx.restore();
        });
      }

      // 6. Draw 3D Nodes sorted Back-to-Front (Painter's Algorithm)
      const sortedNodes = [...nodes3D].sort((a, b) => a.normZ - b.normZ);

      sortedNodes.forEach((node) => {
        const isMatch =
          (!currentQuery || humanizeNodeTitle(node.title).toLowerCase().includes(currentQuery)) &&
          (currentType === 'all' || node.type === currentType);

        const isHovered = currentHovered?.id === node.id;
        const isSelected = currentSelected?.id === node.id;
        const isConnectedNeighbor = selectedNeighborIds.has(node.id) || hoveredNeighborIds.has(node.id);

        const nodeColor = getCategoryColor(node.type, node.tags);
        const isFocalActive = Boolean(currentHovered || currentSelected);
        const isDimmed = isFocalActive && !isHovered && !isSelected && !isConnectedNeighbor;

        let alpha = node.opacity;
        if (isDimmed) alpha *= 0.16;
        if (!isMatch) alpha *= 0.25;

        // Hover outer glow ring (front nodes only)
        if (isHovered && node.normZ > -0.1) {
          ctx.beginPath();
          ctx.arc(node.screenX, node.screenY, node.radius + 6, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(7, 85, 233, 0.22)';
          ctx.fill();
        }

        // Main Node Circle
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(node.screenX, node.screenY, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = isMatch ? nodeColor : '#94A3B8';
        ctx.fill();

        if (node.normZ > -0.15) {
          ctx.lineWidth = isSelected ? 3 : 1.5;
          ctx.strokeStyle = isSelected ? '#0F172A' : '#FFFFFF';
          ctx.stroke();
        }
        ctx.restore();

        // 7. Label Occlusion Culling:
        // LABELS ON THE BACK ARE COMPLETELY HIDDEN so the front view is NEVER disturbed!
        const isFrontFacing = node.normZ > 0.05;
        const nodeDegree = degreeById.get(node.id) || 0;
        const isHub = nodeDegree >= 3;

        const shouldShowLabel =
          isFrontFacing &&
          !isDimmed &&
          (isSelected ||
            isHovered ||
            isConnectedNeighbor ||
            (isMatch && (
              currentDensity === 'all'
                ? true
                : currentDensity === 'hubs'
                ? (isHub || zoom3DRef.current > 1.25)
                : false
            )));

        if (shouldShowLabel) {
          const title = formatTitle(node.title, isHovered || isSelected);
          drawPillBadge(title, node.screenX + node.radius + 4, node.screenY, isHovered || isSelected, isHovered, nodeColor);
        }
      });

      ctx.restore();
    };

    // Unified Draw Router
    const draw = () => {
      if (viewModeRef.current === '3d') {
        draw3D();
      } else {
        draw2D();
      }
    };

    drawRef.current = draw;

    // Zoom behavior for 2D mode (defined before tick/auto-fit)
    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.15, 4])
      .filter((event) => {
        if (viewModeRef.current === '3d') return false;
        if (event.button !== 0 || event.shiftKey) return false;
        if (event.type === 'mousedown') {
          const rect = canvas.getBoundingClientRect();
          const mouseX = event.clientX - rect.left;
          const mouseY = event.clientY - rect.top;
          const t = transformRef.current;
          const gx = (mouseX - t.x) / t.k;
          const gy = (mouseY - t.y) / t.k;
          if (findNodeAt2D(gx, gy)) {
            return false;
          }
        }
        return true;
      })
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        draw();
      });

    d3.select(canvas).call(zoom);

    // Helper to auto-fit graph in 2D with synchronized D3 zoom transform
    const fitToGraph = (animate = false) => {
      if (viewModeRef.current !== '2d' || nodes.length === 0) return;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let validCount = 0;
      nodes.forEach((n) => {
        if (n.x !== undefined && n.y !== undefined) {
          minX = Math.min(minX, n.x);
          maxX = Math.max(maxX, n.x);
          minY = Math.min(minY, n.y);
          maxY = Math.max(maxY, n.y);
          validCount++;
        }
      });

      if (validCount === 0) return;

      const graphW = maxX - minX;
      const graphH = maxY - minY;
      if (graphW > 20 && graphH > 20) {
        const pad = 75;
        const scaleX = (width - pad * 2) / graphW;
        const scaleY = (height - pad * 2) / graphH;
        const fitScale = Math.min(1.05, Math.max(0.35, Math.min(scaleX, scaleY)));
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;

        const targetTransform = d3.zoomIdentity
          .translate(width / 2 - midX * fitScale, height / 2 - midY * fitScale)
          .scale(fitScale);

        transformRef.current = targetTransform;
        const sel = d3.select(canvas);
        if (animate) {
          sel.transition().duration(400).call(zoom.transform, targetTransform);
        } else {
          sel.call(zoom.transform, targetTransform);
        }
        draw();
      }
    };

    let autoFitDone = false;
    simulation.on('tick', () => {
      if (viewModeRef.current === '2d') {
        draw();
        if (!autoFitDone && simulation.alpha() < 0.22) {
          autoFitDone = true;
          fitToGraph();
        }
      }
    });

    const fallbackFitTimer = setTimeout(() => {
      if (!autoFitDone) {
        autoFitDone = true;
        fitToGraph();
      }
    }, 550);

    // 3D Smooth Animation Loop (Auto-rotate, camera target animation, momentum decay)
    let animationFrameId: number;
    const animate3D = () => {
      if (viewModeRef.current === '3d') {
        let changed = false;

        if (targetRotRef.current) {
          const dx = targetRotRef.current.x - rotXRef.current;
          const dy = targetRotRef.current.y - rotYRef.current;
          if (Math.abs(dx) > 0.005 || Math.abs(dy) > 0.005) {
            rotXRef.current += dx * 0.12;
            rotYRef.current += dy * 0.12;
            changed = true;
          } else {
            rotXRef.current = targetRotRef.current.x;
            rotYRef.current = targetRotRef.current.y;
            targetRotRef.current = null;
            changed = true;
          }
        } else if (autoRotateRef.current && !isDragging3DRef.current) {
          rotYRef.current += 0.0016;
          changed = true;
        }

        if (!isDragging3DRef.current) {
          if (Math.abs(rotVelXRef.current) > 0.0001 || Math.abs(rotVelYRef.current) > 0.0001) {
            rotXRef.current += rotVelXRef.current;
            rotYRef.current += rotVelYRef.current;
            rotVelXRef.current *= 0.92;
            rotVelYRef.current *= 0.92;
            changed = true;
          }
        }

        rotXRef.current = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, rotXRef.current));

        if (changed) {
          draw3D();
        }
      }
      animationFrameId = requestAnimationFrame(animate3D);
    };

    animationFrameId = requestAnimationFrame(animate3D);

    // Mouse Interaction Handlers for 2D and 3D
    let activeDragNode: GraphNode | null = null;
    let isDraggingNode = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let isShiftConnecting = false;

    const handleMouseDown = (event: MouseEvent) => {
      setContextMenu(null);
      if (event.button !== 0) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      if (viewModeRef.current === '3d') {
        const hit3D = findNodeAt3D(mouseX, mouseY);
        if (hit3D) {
          activeDragNode = hit3D;
          dragStartX = event.clientX;
          dragStartY = event.clientY;
          isDraggingNode = false;
        } else {
          isDragging3DRef.current = true;
          lastMousePos3DRef.current = { x: event.clientX, y: event.clientY };
          rotVelXRef.current = 0;
          rotVelYRef.current = 0;
          canvas.style.cursor = 'grabbing';
        }
        return;
      }

      const t = transformRef.current;
      const gx = (mouseX - t.x) / t.k;
      const gy = (mouseY - t.y) / t.k;
      const hit = findNodeAt2D(gx, gy);

      if (connectingSourceRef.current) {
        if (hit && hit.id !== connectingSourceRef.current.id) {
          completeLink(connectingSourceRef.current.id, hit.id);
          return;
        } else if (!hit) {
          setConnectingSource(null);
          connectingSourceRef.current = null;
          connectingMousePosRef.current = null;
          draw();
          return;
        }
      }

      if (hit) {
        activeDragNode = hit;
        isDraggingNode = false;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        isShiftConnecting = event.shiftKey;

        if (isShiftConnecting) {
          setConnectingSource(hit);
          connectingSourceRef.current = hit;
          connectingMousePosRef.current = { x: gx, y: gy };
          draw();
        } else {
          hit.fx = hit.x;
          hit.fy = hit.y;
          simulation.alphaTarget(0.3).restart();
        }
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      if (viewModeRef.current === '3d') {
        if (isDragging3DRef.current && lastMousePos3DRef.current) {
          const dx = event.clientX - lastMousePos3DRef.current.x;
          const dy = event.clientY - lastMousePos3DRef.current.y;
          lastMousePos3DRef.current = { x: event.clientX, y: event.clientY };

          rotVelYRef.current = dx * 0.0055;
          rotVelXRef.current = -dy * 0.0055;
          rotYRef.current += rotVelYRef.current;
          rotXRef.current += rotVelXRef.current;

          targetRotRef.current = null;
          draw3D();
          return;
        }

        const hit3D = findNodeAt3D(mouseX, mouseY);
        const prevHovered = hoveredNodeRef.current;
        if (prevHovered?.id !== hit3D?.id) {
          hoveredNodeRef.current = hit3D;
          setHoveredNode(hit3D);
          canvas.style.cursor = hit3D ? 'pointer' : 'grab';
          draw3D();
        }
        return;
      }

      const t = transformRef.current;
      const gx = (mouseX - t.x) / t.k;
      const gy = (mouseY - t.y) / t.k;

      if (activeDragNode) {
        const dist = Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY);
        if (dist > 3) isDraggingNode = true;

        if (isShiftConnecting || connectingSourceRef.current) {
          connectingMousePosRef.current = { x: gx, y: gy };
          const targetHit = findNodeAt2D(gx, gy);
          if (targetHit && targetHit.id !== connectingSourceRef.current?.id) {
            hoveredNodeRef.current = targetHit;
            setHoveredNode(targetHit);
          } else {
            hoveredNodeRef.current = null;
            setHoveredNode(null);
          }
          draw();
          return;
        } else if (isDraggingNode) {
          activeDragNode.fx = gx;
          activeDragNode.fy = gy;
          draw();
          return;
        }
      }

      const found = findNodeAt2D(gx, gy);
      const prevHovered = hoveredNodeRef.current;
      if (prevHovered?.id !== found?.id) {
        hoveredNodeRef.current = found;
        setHoveredNode(found);
        canvas.style.cursor = found ? 'grab' : 'default';
        draw();
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (viewModeRef.current === '3d') {
        if (isDragging3DRef.current) {
          isDragging3DRef.current = false;
          lastMousePos3DRef.current = null;
          canvas.style.cursor = 'grab';
        }

        if (activeDragNode && !isDraggingNode) {
          if (compact) {
            onSelectPage(activeDragNode.id);
          } else {
            setSelectedNode(activeDragNode);
            const n3d = nodes3DRef.current.find((n) => n.id === activeDragNode?.id);
            if (n3d) {
              const targetY = -Math.atan2(n3d.x0, n3d.z0);
              const targetX = Math.asin(Math.max(-1, Math.min(1, n3d.y0)));
              targetRotRef.current = { x: targetX, y: targetY };
            }
          }
        }

        activeDragNode = null;
        isDraggingNode = false;
        return;
      }

      if (!activeDragNode) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const t = transformRef.current;
      const gx = (mouseX - t.x) / t.k;
      const gy = (mouseY - t.y) / t.k;

      if (isShiftConnecting && connectingSourceRef.current) {
        const targetNode = findNodeAt2D(gx, gy);
        if (targetNode && targetNode.id !== connectingSourceRef.current.id) {
          completeLink(connectingSourceRef.current.id, targetNode.id);
        } else {
          setConnectingSource(null);
          connectingSourceRef.current = null;
          connectingMousePosRef.current = null;
          draw();
        }
      } else if (!isDraggingNode) {
        if (!connectingSourceRef.current) {
          if (compact) onSelectPage(activeDragNode.id);
          else setSelectedNode(activeDragNode);
        }
        activeDragNode.fx = null;
        activeDragNode.fy = null;
        simulation.alphaTarget(0);
      } else {
        activeDragNode.fx = null;
        activeDragNode.fy = null;
        simulation.alphaTarget(0);
        canvas.style.cursor = 'grab';
      }

      activeDragNode = null;
      isDraggingNode = false;
      isShiftConnecting = false;
    };

    const handleWheel = (event: WheelEvent) => {
      if (viewModeRef.current === '3d') {
        event.preventDefault();
        const delta = event.deltaY > 0 ? 0.92 : 1.08;
        zoom3DRef.current = Math.min(2.2, Math.max(0.65, zoom3DRef.current * delta));
        draw3D();
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      let hit: GraphNode | null = null;
      if (viewModeRef.current === '3d') {
        hit = findNodeAt3D(mouseX, mouseY);
      } else {
        const t = transformRef.current;
        const gx = (mouseX - t.x) / t.k;
        const gy = (mouseY - t.y) / t.k;
        hit = findNodeAt2D(gx, gy);
      }

      if (hit) {
        setContextMenu({
          node: hit,
          x: event.clientX,
          y: event.clientY,
        });
      } else {
        setContextMenu(null);
      }
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('contextmenu', handleContextMenu);

    return () => {
      clearTimeout(fallbackFitTimer);
      cancelAnimationFrame(animationFrameId);
      simulation.stop();
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('wheel', handleWheel);
      window.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [pages, links, completeLink, onSelectPage, compact]);

  // Keyboard shortcut: Escape cancels connecting mode and closes context menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setConnectingSource(null);
        setContextMenu(null);
        connectingSourceRef.current = null;
        connectingMousePosRef.current = null;
        drawRef.current?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleZoomIn = useCallback(() => {
    if (viewModeRef.current === '3d') {
      zoom3DRef.current = Math.min(2.2, zoom3DRef.current * 1.25);
      drawRef.current?.();
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const current = transformRef.current;
    const nextScale = Math.min(4, current.k * 1.3);
    const ratio = nextScale / current.k;
    transformRef.current = d3.zoomIdentity.translate(
      container.clientWidth / 2 - (container.clientWidth / 2 - current.x) * ratio,
      container.clientHeight / 2 - (container.clientHeight / 2 - current.y) * ratio
    ).scale(nextScale);
    drawRef.current?.();
  }, []);

  const handleZoomOut = useCallback(() => {
    if (viewModeRef.current === '3d') {
      zoom3DRef.current = Math.max(0.65, zoom3DRef.current * 0.8);
      drawRef.current?.();
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const current = transformRef.current;
    const nextScale = Math.max(0.2, current.k * 0.7);
    const ratio = nextScale / current.k;
    transformRef.current = d3.zoomIdentity.translate(
      container.clientWidth / 2 - (container.clientWidth / 2 - current.x) * ratio,
      container.clientHeight / 2 - (container.clientHeight / 2 - current.y) * ratio
    ).scale(nextScale);
    drawRef.current?.();
  }, []);

  const handleReset = useCallback(() => {
    if (viewModeRef.current === '3d') {
      rotXRef.current = 0.15;
      rotYRef.current = 0;
      zoom3DRef.current = 1.0;
      targetRotRef.current = null;
      drawRef.current?.();
      return;
    }
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const nodes = simulationRef.current?.nodes() || [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let count = 0;
    nodes.forEach((n) => {
      if (n.x !== undefined && n.y !== undefined) {
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
        count++;
      }
    });
    if (count > 0 && maxX > minX) {
      const pad = 75;
      const fitScale = Math.min(1.05, Math.max(0.35, Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY))));
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;
      const targetTransform = d3.zoomIdentity.translate(width / 2 - midX * fitScale, height / 2 - midY * fitScale).scale(fitScale);
      transformRef.current = targetTransform;
      d3.select(canvas).transition().duration(350).call(d3.zoom().transform as any, targetTransform);
      drawRef.current?.();
    } else {
      transformRef.current = d3.zoomIdentity;
      drawRef.current?.();
    }
  }, []);

  const handleFitSelection = useCallback(() => {
    const selected = selectedNodeRef.current;
    if (viewModeRef.current === '3d') {
      if (selected) {
        const n3d = nodes3DRef.current.find((n) => n.id === selected.id);
        if (n3d) {
          const targetY = -Math.atan2(n3d.x0, n3d.z0);
          const targetX = Math.asin(Math.max(-1, Math.min(1, n3d.y0)));
          targetRotRef.current = { x: targetX, y: targetY };
        }
      }
      return;
    }
    const node = simulationRef.current?.nodes().find((candidate) => candidate.id === selected?.id);
    const container = containerRef.current;
    if (!node || node.x === undefined || node.y === undefined || !container) return;
    const scale = 1.6;
    transformRef.current = d3.zoomIdentity
      .translate(container.clientWidth / 2 - node.x * scale, container.clientHeight / 2 - node.y * scale)
      .scale(scale);
    drawRef.current?.();
  }, []);

  const handleToggleConnect = useCallback(() => {
    if (connectingSource) {
      setConnectingSource(null);
      connectingSourceRef.current = null;
      connectingMousePosRef.current = null;
      drawRef.current?.();
    } else {
      const source = selectedNode || hoveredNode;
      if (source) {
        setConnectingSource(source);
        connectingSourceRef.current = source;
        drawRef.current?.();
      } else {
        showToast('Select a source note before connecting.');
      }
    }
  }, [connectingSource, selectedNode, hoveredNode, showToast]);

  const availableCategories = Array.from(new Set(pages.map((p) => p.type || 'note')));

  const candidateTargets = connectingSource
    ? pages.filter((p) => p.id !== connectingSource.id && (!connectSearchQuery || humanizeNodeTitle(p.title).toLowerCase().includes(connectSearchQuery.toLowerCase())))
    : [];

  const filteredPages = pages.filter((page) =>
    (!searchQuery || humanizeNodeTitle(page.title).toLowerCase().includes(searchQuery.toLowerCase()))
    && (selectedType === 'all' || page.type === selectedType)
  );

  const selectedPage = selectedNode ? allPages.find((page) => page.id === selectedNode.id) : undefined;
  const incomingPages = selectedPage
    ? Array.from(new Set(allLinks.filter((link) => link.to_page_id === selectedPage.id).map((link) => link.from_page_id))).map((id) => allPages.find((page) => page.id === id)).filter((page): page is Page => Boolean(page))
    : [];
  const outgoingPages = selectedPage
    ? Array.from(new Set(allLinks.filter((link) => link.from_page_id === selectedPage.id).map((link) => link.to_page_id))).map((id) => allPages.find((page) => page.id === id)).filter((page): page is Page => Boolean(page))
    : [];

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        position: 'relative',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: '#FAFCFF',
      }}
    >
      <GraphToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedType={selectedType}
        onTypeSelect={setSelectedType}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={handleReset}
        onFitSelection={selectedNode ? handleFitSelection : undefined}
        availableCategories={availableCategories}
        isConnecting={!!connectingSource}
        onToggleConnect={handleToggleConnect}
        scope={scope}
        onScopeChange={setScope}
        localScopeAvailable={Boolean(activePageId)}
        resultCount={filteredPages.length}
        totalCount={pages.length}
        compact={compact}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        hideOrphans={hideOrphans}
        onToggleHideOrphans={() => setHideOrphans(!hideOrphans)}
        autoRotate={autoRotate}
        onToggleAutoRotate={() => setAutoRotate(!autoRotate)}
        labelDensity={labelDensity}
        onLabelDensityChange={setLabelDensity}
      />

      <canvas
        ref={canvasRef}
        className="knowledge-graph__canvas"
        aria-label={`Knowledge graph with ${pages.length} notes and ${links.length} connections`}
      />

      {/* 3D Interactive Helper Badge */}
      {viewMode === '3d' && !compact && (
        <div className="graph-hint-badge">
          <i />
          <span><strong>3D Knowledge Globe</strong>: Drag to orbit • Scroll to zoom • Front notes active</span>
        </div>
      )}

      {!compact && searchQuery && (
        <div className="graph-search-results" role="listbox" aria-label="Matching graph notes">
          {filteredPages.slice(0, 8).map((page) => (
            <button
              type="button"
              role="option"
              aria-selected={selectedNode?.id === page.id}
              key={page.id}
              onClick={() => {
                const nodeCandidate = { id: page.id, title: page.title, type: page.type, tags: page.tags };
                setSelectedNode(nodeCandidate);
                if (viewModeRef.current === '3d') {
                  const n3d = nodes3DRef.current.find((n) => n.id === page.id);
                  if (n3d) {
                    const targetY = -Math.atan2(n3d.x0, n3d.z0);
                    const targetX = Math.asin(Math.max(-1, Math.min(1, n3d.y0)));
                    targetRotRef.current = { x: targetX, y: targetY };
                  }
                }
              }}
            >
              <i style={{ background: getCategoryColor(page.type, page.tags) }} />
              <span>{humanizeNodeTitle(page.title)}</span>
              <small>{page.type}</small>
            </button>
          ))}
          {filteredPages.length === 0 && <p>No matching notes. Try another title or type.</p>}
        </div>
      )}

      {!compact && (
        <div className="graph-legend" aria-label="Note type legend">
          {availableCategories.map((category) => (
            <span key={category}>
              <i style={{ background: getCategoryColor(category) }} />
              {category}
            </span>
          ))}
        </div>
      )}

      {!compact && selectedPage && (
        <GraphInspector
          page={selectedPage}
          incoming={incomingPages}
          outgoing={outgoingPages}
          onOpen={() => onSelectPage(selectedPage.id)}
          onConnect={onLinkPages ? () => {
            const source = { id: selectedPage.id, title: selectedPage.title, type: selectedPage.type, tags: selectedPage.tags };
            setConnectingSource(source);
            connectingSourceRef.current = source;
          } : undefined}
          onSelect={(pageId) => {
            const page = allPages.find((candidate) => candidate.id === pageId);
            if (page) {
              const candidate = { id: page.id, title: page.title, type: page.type, tags: page.tags };
              setSelectedNode(candidate);
              if (viewModeRef.current === '3d') {
                const n3d = nodes3DRef.current.find((n) => n.id === pageId);
                if (n3d) {
                  const targetY = -Math.atan2(n3d.x0, n3d.z0);
                  const targetX = Math.asin(Math.max(-1, Math.min(1, n3d.y0)));
                  targetRotRef.current = { x: targetX, y: targetY };
                }
              }
            }
          }}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {/* Floating Connecting Mode Banner */}
      {connectingSource && (
        <div
          className="clean-panel modal-content"
          style={{
            position: 'absolute',
            top: '76px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '12px 20px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: '#FFFFFF',
            boxShadow: 'var(--shadow-lg)',
            border: '2px solid #0755E9',
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            minWidth: '420px',
            maxWidth: '540px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--open-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#0755E9',
                }}
              >
                <Link2 size={14} />
              </div>
              <div>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Link from:</span>{' '}
                <strong style={{ fontSize: '0.88rem', color: '#0755E9' }}>{connectingSource.title}</strong>
              </div>
            </div>
            <button
              onClick={() => {
                setConnectingSource(null);
                connectingSourceRef.current = null;
                connectingMousePosRef.current = null;
                drawRef.current?.();
              }}
              className="btn btn-ghost"
              style={{ padding: '4px', color: 'var(--text-muted)' }}
              title="Cancel Linking (Esc)"
            >
              <X size={16} />
            </button>
          </div>

          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            👉 Click any node on the graph canvas, or pick a target note below:
          </div>

          {/* Quick Target Note Selector */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                backgroundColor: '#F8FAFC',
              }}
            >
              <Search size={13} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="Search target note..."
                value={connectSearchQuery}
                onChange={(e) => setConnectSearchQuery(e.target.value)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  fontSize: '0.78rem',
                  width: '100%',
                }}
              />
            </div>
          </div>

          <div
            style={{
              maxHeight: '140px',
              overflowY: 'auto',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: '#FFFFFF',
            }}
          >
            {candidateTargets.slice(0, 5).map((tgt) => (
              <button
                type="button"
                key={tgt.id}
                onClick={() => completeLink(connectingSource.id, tgt.id)}
                style={{
                  padding: '6px 12px',
                  fontSize: '0.78rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  borderBottom: '1px solid #F1F5F9',
                  borderTop: 0,
                  borderLeft: 0,
                  borderRight: 0,
                  backgroundColor: '#FFFFFF',
                  width: '100%',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--open-bg)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#FFFFFF')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: getCategoryColor(tgt.type, tgt.tags),
                    }}
                  />
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{humanizeNodeTitle(tgt.title)}</span>
                </div>
                <span style={{ fontSize: '0.7rem', color: '#0755E9', fontWeight: 600 }}>Link →</span>
              </button>
            ))}
            {candidateTargets.length === 0 && (
              <p style={{ margin: 0, padding: '10px 12px', color: 'var(--text-muted)', fontSize: '0.76rem' }}>
                No available target notes.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Right-Click Node Context Menu */}
      {contextMenu && (
        <div
          className="clean-panel modal-content"
          style={{
            position: 'fixed',
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`,
            zIndex: 100,
            borderRadius: 'var(--radius-sm)',
            backgroundColor: '#FFFFFF',
            boxShadow: 'var(--shadow-lg)',
            border: '1px solid var(--border-subtle)',
            minWidth: '200px',
            padding: '6px 0',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              padding: '6px 14px',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: 'var(--text-muted)',
              borderBottom: '1px solid var(--border-subtle)',
              marginBottom: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {contextMenu.node.title}
          </div>

          <button
            onClick={() => {
              setConnectingSource(contextMenu.node);
              connectingSourceRef.current = contextMenu.node;
              setContextMenu(null);
              drawRef.current?.();
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 14px',
              fontSize: '0.8rem',
              color: '#0755E9',
              fontWeight: 600,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--open-bg)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
          >
            <Link2 size={15} />
            <span>Link to another note...</span>
          </button>

          <button
            onClick={() => {
              onSelectPage(contextMenu.node.id);
              setContextMenu(null);
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 14px',
              fontSize: '0.8rem',
              color: 'var(--text-primary)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F8FAFC')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
          >
            <ExternalLink size={15} />
            <span>Open in Editor</span>
          </button>

          <button
            onClick={() => {
              navigator.clipboard?.writeText(`[[${contextMenu.node.title}]]`);
              showToast(`Copied "[[${contextMenu.node.title}]]" to clipboard`);
              setContextMenu(null);
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 14px',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F8FAFC')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
          >
            <Copy size={15} />
            <span>Copy [[wikilink]]</span>
          </button>
        </div>
      )}

      {/* Hovered Note Card */}
      {hoveredNode && !connectingSource && !selectedPage && (
        <div
          className="clean-panel modal-content"
          style={{
            position: 'absolute',
            bottom: '20px',
            right: '20px',
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: '#FFFFFF',
            maxWidth: '280px',
            pointerEvents: 'none',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <div
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: getCategoryColor(hoveredNode.type, hoveredNode.tags),
              }}
            />
            <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {hoveredNode.title}
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
            Category: {hoveredNode.type}
          </div>
          <div style={{ marginTop: '8px', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            💡 <em>{viewMode === '3d' ? 'Click to center • Drag anywhere to rotate globe' : 'Drag to reposition • Shift+Drag to link • Right-click for options'}</em>
          </div>
        </div>
      )}

      {/* Floating Action Toast Notification */}
      {toastMessage && (
        <div
          className="clean-panel"
          style={{
            position: 'absolute',
            top: '76px',
            right: '20px',
            padding: '10px 16px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: '#0F172A',
            color: '#FFFFFF',
            fontSize: '0.8rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 100,
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <Check size={16} color="#10B981" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Empty Graph State */}
      {pages.length === 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            backgroundColor: '#F8FAFC',
            zIndex: 10,
          }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: '#EFF6FF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--tk-primary)',
            }}
          >
            <Share2 size={28} />
          </div>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Knowledge Graph Empty
          </h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '360px', textAlign: 'center', lineHeight: 1.5 }}>
            Create notes in this vault and link them together using <code style={{ backgroundColor: '#F1F5F9', padding: '2px 6px', borderRadius: '4px' }}>[[wikilinks]]</code> or the graph linker to see your interactive context topology.
          </p>
        </div>
      )}
    </div>
  );
};
