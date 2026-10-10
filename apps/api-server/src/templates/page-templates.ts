/**
 * Reusable starting structures per page type (FR-09). `{{title}}` and `{{date}}` are filled in when a
 * page is created from a template.
 */
export interface PageTemplate {
  type: string;
  label: string;
  tags: string[];
  body: string;
}

const TEMPLATES: PageTemplate[] = [
  { type: 'note', label: 'Note', tags: [], body: '# {{title}}\n\n' },
  {
    type: 'person',
    label: 'Person',
    tags: ['person'],
    body: '# {{title}}\n\n## Role\n\n## Works at\n- [[works_at::]]\n\n## Notes\n\n## Timeline\n',
  },
  {
    type: 'client',
    label: 'Client',
    tags: ['client'],
    body: '# {{title}}\n\nCompiled summary of what we currently know about {{title}}.\n\n## Key contacts\n\n## Engagements\n\n## Architecture highlights\n\n## Open questions\n\n## Timeline\n',
  },
  {
    type: 'project',
    label: 'Project',
    tags: ['project'],
    body: '# {{title}}\n\n## Goal\n\n## Client\n\n## Team\n\n## Status\n\n## Risks\n\n## Decisions\n\n## Timeline\n',
  },
  {
    type: 'decision',
    label: 'Decision',
    tags: ['decision'],
    body: '# {{title}}\n\n- **Date:** {{date}}\n- **Status:** Proposed\n\n## Context\n\n## Decision\n\n## Consequences\n\n## Alternatives considered\n',
  },
  {
    type: 'meeting',
    label: 'Meeting',
    tags: ['meeting'],
    body: '# {{title}}\n\n- **Date:** {{date}}\n- **Attendees:**\n\n## Agenda\n\n## Notes\n\n## Decisions\n\n## Action items\n- [ ] \n',
  },
  {
    type: 'skill',
    label: 'Skill',
    tags: ['skill'],
    body: '# {{title}}\n\n## Purpose\n\n## Inputs\n\n## Instructions\n\n## Output format\n',
  },
  { type: 'other', label: 'Other', tags: [], body: '# {{title}}\n\n' },
];

const DAILY_NOTE: PageTemplate = {
  type: 'note',
  label: 'Daily note',
  tags: ['daily'],
  body: '# {{title}}\n\n## Today\n\n## Notes\n\n## Follow-ups\n- [ ] \n',
};

export function listPageTemplates(): PageTemplate[] {
  return TEMPLATES.map((t) => ({ ...t, tags: [...t.tags] }));
}

export function renderPageTemplate(type: string, title: string, date: string): { type: string; tags: string[]; body: string } {
  const template = type === 'daily' ? DAILY_NOTE : TEMPLATES.find((t) => t.type === type) ?? TEMPLATES[0];
  // Function replacers: a title containing `$&` or similar must be inserted literally
  const body = template.body.replace(/\{\{title\}\}/g, () => title).replace(/\{\{date\}\}/g, () => date);
  return { type: template.type, tags: [...template.tags], body };
}
