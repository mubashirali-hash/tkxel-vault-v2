import { Extension } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface UnresolvedLinksOptions {
  /** True when a page with this title or alias exists in the vault. */
  isResolved: (title: string) => boolean;
}

export interface UnresolvedLinkRange {
  from: number;
  to: number;
  title: string;
}

export const unresolvedLinksKey = new PluginKey<DecorationSet>('unresolvedLinks');

const WIKI_LINK = /\[\[([^[\]\n]+)\]\]/g;

/** The page title a wiki-link points at: [[Title]], [[Title|alias]] or [[relation::Title]]. */
export function wikiLinkTargetTitle(inner: string): string {
  let target = inner.split('|')[0];
  const relationEnd = target.indexOf('::');
  if (relationEnd !== -1) target = target.slice(relationEnd + 2);
  return target.trim();
}

/** Finds every wiki-link in the document whose target does not exist. Code is skipped. */
export function findUnresolvedLinks(doc: ProseMirrorNode, isResolved: (title: string) => boolean): UnresolvedLinkRange[] {
  const ranges: UnresolvedLinkRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code) return false;

    // One character per position inside the block, so match offsets map straight to positions
    let text = '';
    node.forEach((child) => {
      const isCode = child.marks.some((mark) => mark.type.spec.code);
      if (child.isText && !isCode) text += child.text;
      else text += '￼'.repeat(child.nodeSize);
    });

    for (const match of text.matchAll(WIKI_LINK)) {
      const title = wikiLinkTargetTitle(match[1]);
      if (!title || isResolved(title)) continue;
      const from = pos + 1 + (match.index ?? 0);
      ranges.push({ from, to: from + match[0].length, title });
    }
    return false;
  });
  return ranges;
}

/**
 * Marks wiki-links that point at a page which does not exist yet (FR-11). It only decorates the
 * view: the document, and so the saved Markdown, is never changed by it.
 */
export const UnresolvedLinks = Extension.create<UnresolvedLinksOptions>({
  name: 'unresolvedLinks',

  addOptions() {
    return { isResolved: () => true };
  },

  addProseMirrorPlugins() {
    const build = (doc: ProseMirrorNode) =>
      DecorationSet.create(
        doc,
        findUnresolvedLinks(doc, this.options.isResolved).map((range) =>
          Decoration.inline(range.from, range.to, {
            class: 'wiki-link--unresolved',
            title: `No page titled "${range.title}" yet`,
          })
        )
      );

    return [
      new Plugin<DecorationSet>({
        key: unresolvedLinksKey,
        state: {
          init: (_config, state) => build(state.doc),
          // Rebuilt when the text changes, or when the list of pages changed (signalled by the meta flag)
          apply: (tr, previous) => (tr.docChanged || tr.getMeta(unresolvedLinksKey) ? build(tr.doc) : previous),
        },
        props: {
          decorations(state) {
            return unresolvedLinksKey.getState(state);
          },
        },
      }),
    ];
  },
});
