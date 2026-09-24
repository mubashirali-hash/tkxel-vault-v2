# ADR-016: Accessible Overlay and Keyboard Interaction

## Status

Accepted

## Context

The redesign introduced reusable dialogs and drawers, while several older feature modals retained independent overlay implementations. Those older overlays had no shared focus containment or restoration. The workspace action menu and integration selector also exposed only partial keyboard conventions, and the import drop zone depended on pointer activation.

## Decision

- All modal surfaces use one focus-management behavior: move focus into the surface, contain Tab and Shift+Tab, close on Escape, and restore focus to the invoking control.
- Every modal and drawer has an accessible dialog name, `aria-modal`, and a programmatically focusable fallback container.
- Action menus support Arrow Up, Arrow Down, Home, End, and Escape, and restore focus after selection.
- Integration choices use tab and tab-panel semantics with Left and Right Arrow navigation.
- Pointer-oriented upload surfaces expose a keyboard-equivalent button interaction.
- Modal dimensions are bounded to the visual viewport, long technical values may wrap, and reduced-motion preferences suppress nonessential movement.

## Consequences

Keyboard and assistive-technology users receive consistent interaction across new and legacy surfaces. New overlays must use the shared dialog primitive or the shared modal-accessibility hook; feature-specific focus implementations are no longer acceptable.

## Guardrails

- Focus containment is interaction support, not authorization. Permissions remain enforced by server-side policy.
- Escape and backdrop dismissal must not bypass confirmation for an operation that has already begun.
- Visible labels, status text, and icons must not rely on color alone.
- Compact layouts must keep controls reachable without horizontal application scrolling.
