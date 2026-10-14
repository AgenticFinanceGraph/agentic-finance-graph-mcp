/* Text for a human's terminal. Some fields the CLI prints are written by strangers: an
   agent's declared name, its agent card description, a token's name or symbol. Control
   characters in them could clear or rewrite the screen (ANSI escape sequences), and
   Unicode direction overrides could make an address or a number display in a different
   order than it is stored. This shows each such character as a visible \uXXXX escape
   instead of letting it act, so nothing is hidden and nothing is lost.

   Escaped: C0 controls except tab and newline, DEL, C1 controls (U+0080-U+009F), and the
   bidirectional marks, embeddings, overrides and isolates (U+200E, U+200F, U+202A-U+202E,
   U+2066-U+2069). Only terminal output goes through this; `afg mcp` forwards JSON unchanged. */
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

export function forTerminal(text) {
  return String(text).replace(UNSAFE, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}
