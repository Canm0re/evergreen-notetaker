import React from 'react';
import { Note } from '../types';

interface NoteListProps {
  notes: Note[];
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
}

const NoteList: React.FC<NoteListProps> = ({ notes, selectedNoteId, onSelectNote }) => {
  if (notes.length === 0) {
    return null;
  }
  
  return (
    <nav className="p-2">
      <ul>
        {notes.map((note) => (
          <li key={note.id}>
            <button
              onClick={() => onSelectNote(note.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors duration-150 ${
                selectedNoteId === note.id
                  ? 'bg-sky-500/20 text-sky-300'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              {note.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export default NoteList;