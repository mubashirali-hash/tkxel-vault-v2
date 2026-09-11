import { Router, Request, Response } from 'express';
import { NotesAssistant } from '../ai/notes-assistant.js';

export const aiRouter: Router = Router();
const assistant = new NotesAssistant();

/**
 * Health & Provider status
 */
aiRouter.get('/status', (_req: Request, res: Response): void => {
  res.json({
    status: 'ok',
    provider: assistant.providerName,
    features: ['suggest-links', 'sort-and-categorize', 'ask-note', 'draft-skill'],
  });
});

/**
 * POST /api/ai/suggest-links
 * Analyzes active note content against available vault notes and suggests wiki-links.
 */
aiRouter.post('/suggest-links', async (req: Request, res: Response): Promise<void> => {
  try {
    const { activeNoteTitle, activeNoteContent, vaultNotes } = req.body;

    if (!activeNoteTitle || typeof activeNoteContent !== 'string') {
      res.status(400).json({ error: 'activeNoteTitle and activeNoteContent are required' });
      return;
    }

    const suggestions = await assistant.suggestLinks({
      activeNoteTitle,
      activeNoteContent,
      vaultNotes: Array.isArray(vaultNotes) ? vaultNotes : [],
    });

    res.json({
      success: true,
      count: suggestions.length,
      suggestions,
      provider: assistant.providerName,
    });
  } catch (err: any) {
    console.error('Error in /api/ai/suggest-links:', err);
    res.status(500).json({ error: err.message || 'Failed to generate link suggestions' });
  }
});

/**
 * POST /api/ai/sort-and-categorize
 * Evaluates note text to recommend structured tags, category, and cluster.
 */
aiRouter.post('/sort-and-categorize', async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, content, existingTags } = req.body;

    if (!title || typeof content !== 'string') {
      res.status(400).json({ error: 'title and content are required' });
      return;
    }

    const suggestion = await assistant.sortAndCategorize({
      title,
      content,
      existingTags: Array.isArray(existingTags) ? existingTags : [],
    });

    res.json({
      success: true,
      suggestion,
      provider: assistant.providerName,
    });
  } catch (err: any) {
    console.error('Error in /api/ai/sort-and-categorize:', err);
    res.status(500).json({ error: err.message || 'Failed to sort and categorize note' });
  }
});

/**
 * POST /api/ai/ask
 * Grounded Q&A against active note or vault context.
 */
aiRouter.post('/ask', async (req: Request, res: Response): Promise<void> => {
  try {
    const { question, activeNoteTitle, activeNoteContent, vaultNotes, folders, vaultContext } = req.body;

    if (!question || !activeNoteTitle) {
      res.status(400).json({ error: 'question and activeNoteTitle are required' });
      return;
    }

    const answer = await assistant.askNote({
      question,
      activeNoteTitle,
      activeNoteContent: activeNoteContent || '',
      vaultNotes: Array.isArray(vaultNotes) ? vaultNotes : [],
      folders: Array.isArray(folders) ? folders : [],
      vaultContext,
    });

    res.json({
      success: true,
      ...answer,
      provider: assistant.providerName,
    });
  } catch (err: any) {
    console.error('Error in /api/ai/ask:', err);
    res.status(500).json({ error: err.message || 'Failed to process question' });
  }
});

/**
 * POST /api/ai/draft-skill
 * Converts procedural instructions or prompt templates into valid locked SKILL.md.
 */
aiRouter.post('/draft-skill', async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, content } = req.body;

    if (!title || !content) {
      res.status(400).json({ error: 'title and content are required' });
      return;
    }

    const draft = await assistant.draftSkill({ title, content });

    res.json({
      success: true,
      draft,
      provider: assistant.providerName,
    });
  } catch (err: any) {
    console.error('Error in /api/ai/draft-skill:', err);
    res.status(500).json({ error: err.message || 'Failed to draft skill manifest' });
  }
});
