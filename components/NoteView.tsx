import React from 'react';
import { Note } from '../types';

interface NoteViewProps {
  note: Note;
  onLinkClick: (title: string) => void;
}

const NoteView: React.FC<NoteViewProps> = ({ note, onLinkClick }) => {
  const parseContent = (content: string) => {
    // Regex to split by links, bold, and italics, keeping the delimiters
    const parts = content.split(/(\[\[.*?\]\]|\*\*.*?\*\*|\*.*?\*)/g);
    
    return parts.map((part, index) => {
      if (!part) return null; // Filter out empty strings from split

      // Check for links: [[Title]]
      const linkMatch = part.match(/^\[\[(.*?)\]\]$/);
      if (linkMatch) {
        const title = linkMatch[1];
        return (
          <button
            key={index}
            onClick={() => onLinkClick(title)}
            className="text-sky-400 hover:text-sky-300 bg-sky-900/50 px-1 py-0.5 rounded-md transition-colors duration-150 hover:underline"
          >
            {title}
          </button>
        );
      }
      
      // Check for bold: **Text**
      const boldMatch = part.match(/^\*\*(.*)\*\*$/s);
      if (boldMatch) {
        return <strong key={index}>{boldMatch[1]}</strong>;
      }
      
      // Check for italics: *Text*
      const italicMatch = part.match(/^\*(.*)\*$/s);
      if (italicMatch) {
        return <em key={index}>{italicMatch[1]}</em>;
      }
      
      // It's just plain text
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div className="text-gray-200" style={{fontFamily: "'Lora', serif"}}>
      <h1 className="text-3xl font-bold text-white mb-4 pb-2 border-b border-gray-700" style={{fontFamily: "'Inter', sans-serif"}}>
        {note.title}
      </h1>
      
      <div className="prose prose-invert max-w-none text-lg leading-relaxed text-gray-300 whitespace-pre-wrap">
        {parseContent(note.content)}
      </div>

      <div className="mt-8">
        <h3 className="text-lg font-semibold text-gray-400 uppercase tracking-wider mb-3" style={{fontFamily: "'Inter', sans-serif"}}>
          Supporting Quotes
        </h3>
        <div className="space-y-4">
          {note.quotes.map((quote, index) => (
            <blockquote
              key={index}
              className="border-l-4 border-gray-600 pl-4 italic text-gray-400"
            >
              "{quote}"
            </blockquote>
          ))}
        </div>
      </div>
      
      <div className="mt-8 pt-4 border-t border-gray-800">
        <p className="text-sm text-gray-500" style={{fontFamily: "'Inter', sans-serif"}}>
          <span className="font-semibold">Source:</span> {note.source}
        </p>
      </div>
    </div>
  );
};

export default NoteView;