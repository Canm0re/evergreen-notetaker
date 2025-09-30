import { Note, UnlinkedNote, ProcessingState } from '../types';
import { EXTRACT_CONCEPTS_PROMPT, GENERATE_NOTE_PROMPT, INTERLINK_SINGLE_NOTE_PROMPT } from '../constants';

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL_NAME = "x-ai/grok-4-fast:free";

// Helper to add a delay between API calls
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// Wrapper to handle API retries with exponential backoff.
const callOpenRouterWithRetries = async (
    messages: { role: string; content: string }[],
    maxRetries: number = 3,
    initialDelay: number = 2000
): Promise<any> => {
    let lastError: any = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(OPENROUTER_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://github.com/google/labs-prototypes',
                    'X-Title': 'Evergreen Note Taker',
                },
                body: JSON.stringify({
                    model: MODEL_NAME,
                    messages: messages,
                    max_tokens: 8192,
                    transforms: ["reasoning"],
                    response_format: { "type": "json_object" },
                }),
            });
            
            if (response.ok) {
                return await response.json();
            }

            // If not ok, create an error object and throw it, so the catch block can handle it.
            const errorInfo: any = { status: response.status };
            try {
                errorInfo.body = await response.json();
            } catch {
                errorInfo.body = { message: response.statusText };
            }
            throw errorInfo;
            
        } catch (error: any) {
            lastError = error;
            
            // Check if it's a rate limit error (from the thrown object)
            const isRateLimitError = error?.status === 429;

            if (isRateLimitError) {
                const delayMs = initialDelay * Math.pow(2, attempt);
                console.warn(
                    `Rate limit hit. Retrying in ${delayMs / 1000}s... (Attempt ${attempt + 1}/${maxRetries})`
                );
                await delay(delayMs);
            } else {
                // Not a rate limit error, so we shouldn't retry.
                if (error?.body?.error?.message) {
                    throw new Error(`API Error (${error.status}): ${error.body.error.message}`);
                } else if (error instanceof Error) {
                    throw error; // It was a network error etc.
                } else {
                    throw new Error(`An unknown API error occurred: ${JSON.stringify(error)}`);
                }
            }
        }
    }
    // If all retries failed, throw the last captured error.
    throw lastError;
};

// Helper function for robust JSON parsing from OpenRouter response
const safeParseJsonResponse = <T>(apiResponse: any): T => {
    const contentString = apiResponse?.choices?.[0]?.message?.content;

    if (!contentString || contentString.trim() === '') {
        console.error("OpenRouter API returned empty or invalid content. Full response:", JSON.stringify(apiResponse, null, 2));
        
        const finishReason = apiResponse.choices?.[0]?.finish_reason;

        if (finishReason === 'content_filter') {
            throw new Error(`The request was blocked by a content filter. Please modify the input text.`);
        }
        if (finishReason === 'length' || finishReason === 'max_tokens') {
            throw new Error("The response was cut off because it reached the maximum token limit.");
        }
        
        throw new Error("OpenRouter API returned an empty or invalid response.");
    }

    try {
        return JSON.parse(contentString) as T;
    } catch (e) {
        console.error("Failed to parse JSON response from OpenRouter. Raw content:", contentString);
        if (e instanceof Error) {
            throw new Error(`Invalid JSON response from API: ${e.message}`);
        }
        throw new Error("Invalid JSON response from API.");
    }
};

// Phase 1: Identify all core concepts from the text
const extractConcepts = async (bookContent: string): Promise<string[]> => {
    const messages = [
        { role: "system", content: EXTRACT_CONCEPTS_PROMPT },
        { role: "user", content: bookContent }
    ];
    const response = await callOpenRouterWithRetries(messages);
    return safeParseJsonResponse<string[]>(response);
};

// Phase 2: Generate the body for a single note based on a title
const generateSingleNoteBody = async (bookContent: string, title: string): Promise<Omit<UnlinkedNote, 'title'>> => {
    const messages = [
      { role: "system", content: GENERATE_NOTE_PROMPT },
      { role: "user", content: `Full Text:\n${bookContent}\n\nConcept Title: "${title}"` }
    ];
    const response = await callOpenRouterWithRetries(messages);
    return safeParseJsonResponse<Omit<UnlinkedNote, 'title'>>(response);
};

// Phase 3 Helper: Take one note and add interlinks to it
const interlinkSingleNote = async (noteToLink: UnlinkedNote, allTitles: string[]): Promise<string> => {
    const otherTitles = allTitles.filter(t => t !== noteToLink.title);
    const userPrompt = `Note Content to Revise:\n${noteToLink.content}\n\nList of Available Link Targets:\n${JSON.stringify(otherTitles, null, 2)}`;
    const messages = [
      { role: "system", content: INTERLINK_SINGLE_NOTE_PROMPT },
      { role: "user", content: userPrompt }
    ];
    const response = await callOpenRouterWithRetries(messages);
    const parsed = safeParseJsonResponse<{content: string}>(response);
    return parsed.content;
};

// Orchestrator function that runs the full pipeline
export const processBookWithGemini = async (
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
    
        // Phase 3: Iteratively Interlink notes
        if (state.status !== 'completed' || state.finalNotes.length === 0) {
            const finalNotes: Note[] = [];
            const allNoteTitles = state.unlinkedNotes.map(n => n.title);

            for (let i = 0; i < state.unlinkedNotes.length; i++) {
                const noteToLink = state.unlinkedNotes[i];
                const stage = `Phase 3/3: Interlinking note ${i + 1}/${state.unlinkedNotes.length}: "${noteToLink.title.substring(0, 40)}..."`;
                onProgress({ stage });

                const newContent = await interlinkSingleNote(noteToLink, allNoteTitles);

                finalNotes.push({
                    ...noteToLink,
                    id: `note_${i.toString().padStart(3, '0')}`,
                    content: newContent,
                });
                
                if (i < state.unlinkedNotes.length - 1) {
                    await delay(1500);
                }
            }
            
            state = { ...state, finalNotes };
            onProgress({ finalNotes, status: 'completed', stage: '' });
        }

        return state.finalNotes;

    } catch (error: any) {
        console.error("Error in multi-step AI process:", error);
        
        let descriptiveError = "An unknown error occurred while processing the book.";

        if (error instanceof Error) {
            descriptiveError = error.message;
        }

        // IMPORTANT: Save the error state before throwing
        onProgress({ status: 'error', error: descriptiveError });
        throw new Error(`Failed to process book with AI: ${descriptiveError}`);
    }
};
