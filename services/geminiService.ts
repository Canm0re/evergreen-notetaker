import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { Note, UnlinkedNote, ProcessingState } from '../types';
import { EXTRACT_CONCEPTS_PROMPT, GENERATE_NOTE_PROMPT, INTERLINK_NOTES_PROMPT } from '../constants';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

// Helper to add a delay between API calls
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// Wrapper to handle API retries with exponential backoff, specifically for rate limiting.
const callGeminiWithRetries = async (
    apiCall: () => Promise<GenerateContentResponse>,
    maxRetries: number = 3,
    initialDelay: number = 2000
): Promise<GenerateContentResponse> => {
    let lastError: any = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await apiCall();
        } catch (error: any) {
            lastError = error;
            // The Gemini SDK may throw an error with a JSON string in the message
            const isRateLimitError = error?.message?.includes('"code":429') || error?.message?.includes('RESOURCE_EXHAUSTED');

            if (isRateLimitError) {
                const delayMs = initialDelay * Math.pow(2, attempt); // Exponential backoff: 2s, 4s, 8s...
                console.warn(
                    `Rate limit hit. Retrying in ${delayMs / 1000}s... (Attempt ${attempt + 1}/${maxRetries})`
                );
                await delay(delayMs);
            } else {
                // Not a rate limit error, so we shouldn't retry.
                throw error;
            }
        }
    }
    // If all retries failed, throw the last captured error.
    throw lastError;
};

// Helper function for robust JSON parsing and error handling
const safeParseJsonResponse = <T>(response: GenerateContentResponse): T => {
    const responseText = response.text;

    if (!responseText || responseText.trim() === '') {
        console.error("Gemini API returned an empty response text. Full response:", JSON.stringify(response, null, 2));
        
        const finishReason = response.candidates?.[0]?.finishReason;
        const safetyRatings = response.candidates?.[0]?.safetyRatings;

        if (finishReason === 'SAFETY') {
            const blockedRating = safetyRatings?.find(rating => rating.blocked);
            const reason = blockedRating ? `due to ${blockedRating.category}` : '';
            throw new Error(`The request was blocked by safety settings ${reason}. Please modify the input text.`);
        }
        if (finishReason === 'MAX_TOKENS') {
            throw new Error("The response was cut off because it reached the maximum token limit.");
        }
        
        throw new Error("Gemini API returned an empty or invalid response.");
    }

    try {
        // Sanitize the response text before parsing. The API might return
        // markdown fences (```json ... ```) which need to be stripped.
        const sanitizedText = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        return JSON.parse(sanitizedText) as T;
    } catch (e) {
        console.error("Failed to parse JSON response from Gemini. Response text:", responseText);
        if (e instanceof Error) {
            throw new Error(`Invalid JSON response from API: ${e.message}`);
        }
        throw new Error("Invalid JSON response from API.");
    }
};

// Schema for Step 1: Extracting a list of concept titles
const titlesSchema = {
  type: Type.ARRAY,
  items: { type: Type.STRING },
};

// Schema for Step 2: Generating a single note body (content, quotes, source)
const noteBodySchema = {
    type: Type.OBJECT,
    properties: {
        content: { type: Type.STRING, description: 'The full explanation of the concept, without links.' },
        quotes: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'A list of 1-3 direct quotes from the book.'
        },
        source: { type: Type.STRING, description: 'The location in the book where the information was found.' }
    },
    required: ['content', 'quotes', 'source'],
};

// Schema for Step 3: Interlinking and final output
const finalNotesSchema = {
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        properties: {
            id: { type: Type.STRING },
            title: { type: Type.STRING },
            content: { type: Type.STRING, description: 'The explanation of the concept, now with [[links]].' },
            quotes: { type: Type.ARRAY, items: { type: Type.STRING } },
            source: { type: Type.STRING }
        },
        required: ['id', 'title', 'content', 'quotes', 'source'],
    }
};


// Phase 1: Identify all core concepts from the text
const extractConcepts = async (bookContent: string): Promise<string[]> => {
    const response = await callGeminiWithRetries(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: bookContent,
        config: {
          systemInstruction: EXTRACT_CONCEPTS_PROMPT,
          responseMimeType: "application/json",
          responseSchema: titlesSchema,
        },
    }));
    return safeParseJsonResponse<string[]>(response);
};

// Phase 2: Generate the body for a single note based on a title
const generateSingleNoteBody = async (bookContent: string, title: string): Promise<Omit<UnlinkedNote, 'title'>> => {
    const prompt = `Full Text:\n${bookContent}\n\nConcept Title: "${title}"`;
    const response = await callGeminiWithRetries(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
            systemInstruction: GENERATE_NOTE_PROMPT,
            responseMimeType: "application/json",
            responseSchema: noteBodySchema,
        },
    }));
    return safeParseJsonResponse<Omit<UnlinkedNote, 'title'>>(response);
};

// Phase 3: Take all generated notes and add interlinks
const interlinkNotes = async (notes: UnlinkedNote[]): Promise<Note[]> => {
    const notesWithTempIds = notes.map((note, index) => ({
        ...note,
        id: `note_${index.toString().padStart(3, '0')}`
    }));

    const response = await callGeminiWithRetries(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: JSON.stringify(notesWithTempIds, null, 2),
        config: {
            systemInstruction: INTERLINK_NOTES_PROMPT,
            responseMimeType: "application/json",
            responseSchema: finalNotesSchema,
        },
    }));
    return safeParseJsonResponse<Note[]>(response);
}

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
    
        // Phase 3: Interlink notes
        if (state.status !== 'completed' || state.finalNotes.length === 0) {
            const stage = "Phase 3/3: Weaving the knowledge graph...";
            onProgress({ stage });
            
            const linkedNotesWithIds = await interlinkNotes(state.unlinkedNotes);

            // Ensure IDs are unique if the model fails to do so
            const finalNotes = linkedNotesWithIds.map((note, index) => ({
                ...note,
                id: `note_${index.toString().padStart(3, '0')}`
            }));

            state = { ...state, finalNotes };
            onProgress({ finalNotes, status: 'completed', stage: '' });
        }

        return state.finalNotes;

    } catch (error: any) {
        console.error("Error in multi-step Gemini process:", error);
        
        let descriptiveError = "An unknown error occurred while processing the book.";

        if (error && typeof error.message === 'string') {
            try {
                const parsedError = JSON.parse(error.message);
                if (parsedError.error && parsedError.error.message) {
                    descriptiveError = `API Error: ${parsedError.error.message}`;
                } else {
                    descriptiveError = error.message;
                }
            } catch (e) {
                descriptiveError = error.message;
            }
        } else if (error instanceof Error) {
            descriptiveError = error.message;
        }

        // IMPORTANT: Save the error state before throwing
        onProgress({ status: 'error', error: descriptiveError });
        throw new Error(`Failed to process book with Gemini: ${descriptiveError}`);
    }
};