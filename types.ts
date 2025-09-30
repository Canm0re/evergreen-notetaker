import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3';

export interface Note {
  id: string;
  title: string;
  content: string;
  quotes: string[];
  source: string;
}

export type ProcessingStatus = 'idle' | 'processing' | 'completed' | 'error';

export interface UnlinkedNote {
  title: string;
  content: string;
  quotes: string[];
  source: string;
}

export interface ProcessingState {
  status: ProcessingStatus;
  stage: string; // The descriptive text for the current processing stage
  inputText: string;
  titles: string[];
  unlinkedNotes: UnlinkedNote[];
  finalNotes: Note[];
  error: string | null;
}


export interface D3Node extends SimulationNodeDatum {
    id: string;
    title: string;
}

// FIX: Remove incorrect overrides for `source` and `target`.
// This allows D3Link to correctly inherit the type from SimulationLinkDatum,
// which defines source/target as `string | number | NodeDatum`.
// This is necessary because the d3 simulation mutates the links, replacing
// string IDs with the actual node objects.
export interface D3Link extends SimulationLinkDatum<D3Node> {
}