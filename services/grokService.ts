import { Note, UnlinkedNote, ProcessingState } from '../types';
import { EXTRACT_CONCEPTS_PROMPT, GENERATE_NOTE_PROMPT, INTERLINK_NOTES_PROMPT } from '../constants';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
}

// Helper to add a delay between API calls
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// Helper function for robust JSON parsing
const safeParseJsonResponse = <T>(responseText: string): T => {
  try {
    // Sanitize the response text before parsing. The API might return
    // markdown fences (```json ... ```) which need to be stripped.
    const sanitizedText = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    return JSON.parse(sanitizedText) as T;
  } catch (error) {
    console.error("Failed to parse API response as JSON:", error);
    throw new Error("Invalid response format from API");
  }
};

// Wrapper to handle API retries with exponential backoff
const callGrokWithRetries = async (
  messages: Array<{ role: string; content: string }>,
  maxRetries: number = 3,
  initialDelay: number = 2000
): Promise<string> => {
  let lastError: any = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'http://localhost:5173', // Replace with your actual domain in production
          'X-Title': 'Evergreen Notetaker'
        },
        body: JSON.stringify({
          model: 'x-ai/grok-4-fast:free',
          messages: messages,
          extra_body: {
            enable_reasoning: true
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} ${errorText}`);
      }

      const data: OpenRouterResponse = await response.json();
      return data.choices[0]?.message?.content || '';
    } catch (error: any) {
      lastError = error;
      const isRateLimitError = error?.message?.includes('429') || error?.message?.includes('too many requests');

      if (isRateLimitError && attempt < maxRetries - 1) {
        const delayMs = initialDelay * Math.pow(2, attempt);
        console.warn(
          `Rate limit hit. Retrying in ${delayMs / 1000}s... (Attempt ${attempt + 1}/${maxRetries})`
        );
        await delay(delayMs);
      } else {
        throw error;
      }
    }
  }
  throw lastError;
};

// Phase 1: Extract Concepts
const extractConcepts = async (text: string): Promise<string[]> => {
  const messages = [
    { role: "system", content: EXTRACT_CONCEPTS_PROMPT },
    { role: "user", content: text }
  ];
  
  const response = await callGrokWithRetries(messages);
  return safeParseJsonResponse<string[]>(response);
};

// Phase 2: Generate Note Body
const generateSingleNoteBody = async (bookContent: string, title: string): Promise<Omit<UnlinkedNote, 'title'>> => {
  const messages = [
    { role: "system", content: GENERATE_NOTE_PROMPT },
    { role: "user", content: JSON.stringify({ text: bookContent, concept: title }) }
  ];
  
  const response = await callGrokWithRetries(messages);
  return safeParseJsonResponse<Omit<UnlinkedNote, 'title'>>(response);
};

// Phase 3: Interlink Notes
const interlinkNotes = async (notes: UnlinkedNote[]): Promise<Note[]> => {
  const notesWithTempIds = notes.map((note, index) => ({
    ...note,
    id: `note_${index.toString().padStart(3, '0')}`
  }));

  const messages = [
    { role: "system", content: INTERLINK_NOTES_PROMPT },
    { role: "user", content: JSON.stringify(notesWithTempIds) }
  ];
  
  const response = await callGrokWithRetries(messages);
  const linkedNotes = safeParseJsonResponse<Note[]>(response);

  // Ensure IDs are unique if the model fails to do so
  return linkedNotes.map((note, index) => ({
    ...note,
    id: `note_${index.toString().padStart(3, '0')}`
  }));
};

// Orchestrator function that runs the full pipeline
const processBookWithGrok = async (
  initialState: ProcessingState,
  onProgress: (update: Partial<ProcessingState>) => void
): Promise<Note[]> => {
  let state: ProcessingState = { ...initialState };

  try {
    // Phase 1: Extract Concepts
    if (state.titles.length === 0) {
      const stage = "Phase 1/3: Extracting core concepts...";
      onProgress({ stage, status: 'processing' });
      const titles = await extractConcepts(state.inputText);
      state = { ...state, titles };
      onProgress({ titles });
    }

    // Phase 2: Generate Notes
    const unlinkedNotes = [...state.unlinkedNotes];
    const startIndex = unlinkedNotes.length;

    if (startIndex < state.titles.length) {
      for (let i = startIndex; i < state.titles.length; i++) {
        const title = state.titles[i];
        const stage = `Phase 2/3: Generating note ${i + 1}/${state.titles.length}: "${title.substring(0, 40)}..."`;
        onProgress({ stage });

        const body = await generateSingleNoteBody(state.inputText, title);
        unlinkedNotes.push({ title, ...body });

        state = { ...state, unlinkedNotes: [...unlinkedNotes] };
        onProgress({ unlinkedNotes: state.unlinkedNotes }); // Save after each note
        
        if (i < state.titles.length - 1) {
          await delay(1500);
        }
      }
    }
    state = { ...state, unlinkedNotes };

    // Phase 3: Interlink notes
    if (state.status !== 'completed' || state.finalNotes.length === 0) {
      const stage = "Phase 3/3: Weaving the knowledge graph...";
      onProgress({ stage });
      
      const finalNotes = await interlinkNotes(state.unlinkedNotes);

      state = { ...state, finalNotes };
      onProgress({ finalNotes, status: 'completed', stage: '' });
    }

    return state.finalNotes;

  } catch (error: any) {
    console.error("Error in multi-step Grok process:", error);
    
    let descriptiveError = "An unknown error occurred while processing the book.";

    if (error && typeof error.message === 'string') {
      descriptiveError = error.message;
    }

    // Save the error state before throwing
    onProgress({ status: 'error', error: descriptiveError });
    throw new Error(`Failed to process book with Grok: ${descriptiveError}`);
  }
};

export { processBookWithGrok };