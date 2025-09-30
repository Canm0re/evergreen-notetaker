import React, { useState, useCallback, useMemo, useEffect } from 'react';
import JSZip from 'jszip';
import { Note, ProcessingState, ProcessingStatus } from './types';
import { processBookWithGrok } from './services/grokService.ts';
import NoteList from './components/NoteList';
import NoteView from './components/NoteView';
import NetworkGraph from './components/NetworkGraph';
import { BrainCircuitIcon } from './components/icons/BrainCircuitIcon';
import { LoaderIcon } from './components/icons/LoaderIcon';
import { ErrorIcon } from './components/icons/ErrorIcon';
import { DownloadIcon } from './components/icons/DownloadIcon';
import { ResetIcon } from './components/icons/ResetIcon';
import { PlayIcon } from './components/icons/PlayIcon';

type ViewMode = 'viewer' | 'graph';
const EVERGREEN_SESSION_KEY = 'evergreen-note-session';

const getInitialState = (): ProcessingState => ({
  status: 'idle',
  stage: '',
  inputText: '',
  titles: [],
  unlinkedNotes: [],
  finalNotes: [],
  error: null,
});


const App: React.FC = () => {
  const [session, setSession] = useState<ProcessingState>(getInitialState());
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('viewer');
  
  // Load session from localStorage on initial mount
  useEffect(() => {
    try {
      const savedSession = localStorage.getItem(EVERGREEN_SESSION_KEY);
      if (savedSession) {
        const parsed = JSON.parse(savedSession) as ProcessingState;
        setSession(parsed);
        
        const notes = parsed.status === 'completed' ? parsed.finalNotes : parsed.unlinkedNotes;
        if (notes.length > 0) {
            const firstNoteId = parsed.status === 'completed' ? parsed.finalNotes[0].id : `note_temp_0`;
            setSelectedNoteId(firstNoteId);
        }
      }
    } catch (err) {
      console.error("Failed to load session from localStorage", err);
      localStorage.removeItem(EVERGREEN_SESSION_KEY);
    }
  }, []);

  // Save session to localStorage whenever it changes
  useEffect(() => {
    try {
        localStorage.setItem(EVERGREEN_SESSION_KEY, JSON.stringify(session));
    } catch (err) {
        console.error("Failed to save session to localStorage", err);
    }
  }, [session]);

  const handleProgress = useCallback((update: Partial<ProcessingState>) => {
    setSession(prev => ({ ...prev, ...update }));
  }, []);

  const runProcess = async (stateToProcess: ProcessingState) => {
    setSession(prev => ({
      ...prev,
      status: 'processing',
      error: null,
    }));
    try {
      const finalNotes = await processBookWithGrok(stateToProcess, handleProgress);
      // The final state update is handled via onProgress in the service
      if (finalNotes.length > 0) {
        setSelectedNoteId(finalNotes[0].id);
      }
    } catch (err) {
      // Error state is set via onProgress, so we just log it here.
      console.error("Processing failed:", err);
    }
  };

  const handleStartProcessing = () => {
    if (!session.inputText.trim()) {
      setSession(prev => ({...prev, error: 'Please paste the book content first.'}));
      return;
    }
    const initialState = {
      ...getInitialState(),
      inputText: session.inputText,
    };
    runProcess(initialState);
  };

  const handleResumeProcessing = () => {
    runProcess({ ...session });
  };


  const handleStartNew = useCallback(() => {
    if (window.confirm("Are you sure you want to clear the current session and start a new one? All notes will be permanently deleted.")) {
      localStorage.removeItem(EVERGREEN_SESSION_KEY);
      setSession(getInitialState());
      setSelectedNoteId(null);
    }
  }, []);

  const notesToDisplay = useMemo(() => {
    if (session.status === 'completed' && session.finalNotes.length > 0) {
        return session.finalNotes;
    }
    // Display unlinked notes as they are generated or if process is interrupted
    if (session.unlinkedNotes.length > 0) {
        return session.unlinkedNotes.map((note, index) => ({
            ...note,
            id: `note_temp_${index}`, // Use a temporary ID for display
            content: note.content // Content will not have links yet
        }));
    }
    return [];
  }, [session]);

  const handleExport = useCallback(async () => {
    const notes = session.finalNotes;
    if (notes.length === 0) return;

    const zip = new JSZip();

    const sanitizeFilename = (title: string) => {
        return title.replace(/[\/\\?%*:|"<>]/g, '-').substring(0, 200);
    };

    notes.forEach(note => {
        const filename = `${sanitizeFilename(note.title)}.md`;

        const quotesMarkdown = note.quotes.length > 0
            ? note.quotes.map(q => `> ${q}`).join('\n\n')
            : '_No quotes available._';

        const markdownContent = `
# ${note.title}

${note.content}

---

## Supporting Quotes

${quotesMarkdown}

---

## Source

${note.source}
        `.trim();

        zip.file(filename, markdownContent);
    });

    try {
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Evergreen-Notes.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch(err) {
        console.error("Failed to generate zip file", err);
        setSession(prev => ({...prev, error: "Could not generate the export file."}));
    }
}, [session.finalNotes]);

  const selectedNote = useMemo(() => {
    return notesToDisplay.find(note => note.id === selectedNoteId) || null;
  }, [notesToDisplay, selectedNoteId]);
  
  const handleSelectNoteByTitle = useCallback((title: string) => {
      // Can only click links if processing is complete and notes are interlinked
      if (session.status !== 'completed') return;

      const foundNote = session.finalNotes.find(n => n.title.trim().toLowerCase() === title.trim().toLowerCase());
      if (foundNote) {
          setSelectedNoteId(foundNote.id);
          setViewMode('viewer');
      }
  }, [session.finalNotes, session.status]);

  const renderContent = () => {
    if (session.status === 'processing') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-gray-400">
          <LoaderIcon className="w-16 h-16 animate-spin text-sky-400" />
          <p className="mt-4 text-lg">{session.stage || 'Initializing...'}</p>
          <p className="text-sm">This may take a several moments. Your progress is being saved.</p>
        </div>
      );
    }

    if (session.status === 'error' && !notesToDisplay.length) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-red-400">
          <ErrorIcon className="w-16 h-16" />
          <p className="mt-4 text-lg font-semibold">An Error Occurred</p>
          <p className="mt-2 text-sm text-center max-w-md">{session.error}</p>
        </div>
      );
    }
    
    if (notesToDisplay.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <BrainCircuitIcon className="w-24 h-24" />
              <h2 className="mt-6 text-2xl font-bold text-gray-300">Evergreen Note Taker</h2>
              <p className="mt-2 text-center max-w-md">
                Paste your book content on the left and click "Process" to generate a network of atomic, interconnected notes.
              </p>
            </div>
        );
    }

    return (
        <>
            <div className="flex justify-center mb-4 border-b border-gray-700">
                <button 
                    onClick={() => setViewMode('viewer')}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${viewMode === 'viewer' ? 'border-b-2 border-sky-400 text-sky-400' : 'text-gray-400 hover:text-white'}`}
                >
                    Note Viewer
                </button>
                <button 
                    onClick={() => setViewMode('graph')}
                    disabled={session.status !== 'completed'}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${viewMode === 'graph' ? 'border-b-2 border-sky-400 text-sky-400' : 'text-gray-400 hover:text-white'} disabled:text-gray-600 disabled:cursor-not-allowed disabled:border-transparent`}
                >
                    Knowledge Graph
                </button>
            </div>
            {session.status === 'error' && (
                <div className="mb-4 p-3 bg-red-900/50 border border-red-700 text-red-300 rounded-md text-sm">
                    <strong>An error occurred:</strong> {session.error} You can attempt to resume the process.
                </div>
            )}
            {viewMode === 'viewer' && selectedNote && (
                <NoteView note={selectedNote} onLinkClick={handleSelectNoteByTitle} />
            )}
            {viewMode === 'graph' && session.status === 'completed' && (
                <NetworkGraph notes={session.finalNotes} onNodeClick={setSelectedNoteId} selectedNoteId={selectedNoteId} />
            )}
        </>
    );
  };
  
  const renderActionButton = () => {
    const isLoading = session.status === 'processing';

    if (session.status === 'error') {
        return (
            <button
                onClick={handleResumeProcessing}
                className="flex-grow bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 px-4 rounded-md transition duration-150 flex items-center justify-center gap-2"
            >
                <PlayIcon className="w-5 h-5" /> Resume
            </button>
        );
    }

    return (
        <button
            onClick={handleStartProcessing}
            disabled={isLoading || !session.inputText.trim()}
            className="flex-grow bg-sky-600 hover:bg-sky-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition duration-150 flex items-center justify-center"
        >
            {isLoading ? <LoaderIcon className="w-5 h-5 animate-spin" /> : 'Process Book'}
        </button>
    );
  };

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-sans">
      <aside className="w-1/3 max-w-md flex flex-col border-r border-gray-800">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <BrainCircuitIcon className="w-6 h-6 text-sky-400" />
            Evergreen Note Taker
          </h1>
        </div>
        
        <div className="p-4 flex-grow flex flex-col">
            <textarea
                value={session.inputText}
                onChange={(e) => setSession(prev => ({...prev, inputText: e.target.value}))}
                placeholder="Paste the full text of a book here..."
                className="w-full h-48 p-3 bg-gray-800 border border-gray-700 rounded-md resize-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition duration-150 text-sm disabled:bg-gray-700/50"
                disabled={session.status === 'processing' || session.status === 'error'}
            />
            <div className="mt-3 flex items-center gap-2">
              {renderActionButton()}
              {(session.status !== 'idle' || session.inputText) && session.status !== 'processing' && (
                 <button
                    onClick={handleStartNew}
                    title="Start a new session"
                    className="p-2 bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white rounded-md transition-colors"
                 >
                    <ResetIcon className="w-5 h-5"/>
                 </button>
              )}
            </div>
        </div>
        
        <div className="flex-grow flex flex-col overflow-hidden">
            {notesToDisplay.length > 0 && (
                <div className="px-4 py-3 flex justify-between items-center border-t border-b border-gray-800 shrink-0">
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Generated Notes</h2>
                  <button
                    onClick={handleExport}
                    className="flex items-center gap-2 text-sm text-gray-300 hover:text-sky-400 transition-colors disabled:text-gray-600 disabled:cursor-not-allowed"
                    title="Export notes as Markdown for Obsidian"
                    disabled={session.status !== 'completed'}
                  >
                    <DownloadIcon className="w-4 h-4" />
                    <span>Export</span>
                  </button>
                </div>
            )}
            <div className="overflow-y-auto">
                <NoteList
                    notes={notesToDisplay}
                    selectedNoteId={selectedNoteId}
                    onSelectNote={setSelectedNoteId}
                />
            </div>
        </div>
      </aside>

      <main className="w-2/3 flex flex-col">
        <div className="flex-grow p-6 overflow-y-auto">
            {renderContent()}
        </div>
      </main>
    </div>
  );
};

export default App;