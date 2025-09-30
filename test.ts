import { processBookWithGrok } from './services/grokService';
import { ProcessingState } from './types';
import fs from 'fs';

async function testGrokService() {
  const inputText = fs.readFileSync('./test-input.txt', 'utf-8');
  
  const initialState: ProcessingState = {
    status: 'idle',
    stage: '',
    inputText,
    titles: [],
    unlinkedNotes: [],
    finalNotes: [],
    error: null,
  };

  const onProgress = (update: Partial<ProcessingState>) => {
    console.log('Progress Update:', update);
    if (update.titles) {
      console.log('\nExtracted Concepts:', update.titles);
    }
    if (update.unlinkedNotes) {
      console.log('\nGenerated Notes:', update.unlinkedNotes.length);
      console.log('Latest Note:', update.unlinkedNotes[update.unlinkedNotes.length - 1]);
    }
    if (update.finalNotes) {
      console.log('\nFinal Interlinked Notes:', update.finalNotes);
    }
  };

  try {
    console.log('Starting test with Grok...\n');
    const finalNotes = await processBookWithGrok(initialState, onProgress);
    console.log('\nTest completed successfully!');
    console.log('\nFinal Notes:', JSON.stringify(finalNotes, null, 2));
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testGrokService().catch(console.error);