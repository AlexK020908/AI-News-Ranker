// Shared brief types. A brief (X or news) cites its sources by [n] markers in
// the prose/topics; each [n] maps to one BriefCitation pointing at the source
// post(s)/article. The same shape backs both brief surfaces, the email
// renderer, and the on-page CitationChip — declared once here so a field change
// (e.g. adding a thumbnail) lands in one place.

export interface BriefCitation {
  label: string;
  posts: { url: string; handle: string }[];
}

// [n] (as a string key) → its citation. Null when a brief carried no citations.
export type CiteMap = Record<string, BriefCitation> | null;
