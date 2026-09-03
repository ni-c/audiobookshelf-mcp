/**
 * The annotation block every reading tool of this server carries, and the rule
 * the writing ones follow.
 *
 * Written out rather than left to the defaults, because the defaults are not
 * neutral: the specification says `destructiveHint` and `openWorldHint` both
 * default to **true**, so an omitted field is the *stronger* claim. A tool that
 * says nothing is a destructive tool in an open world.
 *
 * The line this family draws for `destructiveHint`, since the specification
 * only offers "destructive" against "additive only" and most writes are
 * neither obviously:
 *
 *   **Content that a person wrote, replaced with no way back — destructive.**
 *   **A setting, a state or a marker, changed — not destructive.**
 *
 * So `update_collection` is destructive (it replaces a name and description
 * somebody typed) while `set_media_progress` is not (a listening position is a
 * marker, and moving it is what the tool is for). Deleting anything is
 * destructive. Creating and adding are additive.
 *
 * `openWorldHint: false` is the honest answer here: this server talks to the
 * one Audiobookshelf it is configured for. The specification's own example
 * draws the line there — a web search is an open world, a library you point at
 * is not.
 */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
