import { Page } from '@tkxel-vault/types';

export function applyAiContentTransform(
  page: Page,
  mode: 'replace' | 'append' | 'insert',
  newText: string
): Page {
  let updatedContent = page.content || '';
  if (mode === 'replace') {
    updatedContent = newText;
  } else if (mode === 'append') {
    updatedContent = updatedContent ? `${updatedContent}\n\n${newText}` : newText;
  } else if (mode === 'insert') {
    updatedContent = `${newText}\n\n${updatedContent}`;
  }

  const { body: _scrubbedBody, ...cleanFrontMatter } = (page.front_matter || {}) as any;

  return {
    ...page,
    content: updatedContent,
    front_matter: cleanFrontMatter,
    updated_at: new Date(),
  };
}
