/**
 * Minimal local typing for `turndown` (ships no types; @types/turndown is not
 * a sanctioned dep this chunk). Only the surface the gmail sync uses.
 */
declare module "turndown" {
  interface TurndownOptions {
    headingStyle?: "setext" | "atx";
    codeBlockStyle?: "indented" | "fenced";
    emDelimiter?: "_" | "*";
    hr?: string;
    bulletListMarker?: "-" | "+" | "*";
    strongDelimiter?: "__" | "**";
  }

  class TurndownService {
    constructor(options?: TurndownOptions);
    turndown(html: string): string;
    remove(filter: string | string[]): this;
    addRule(key: string, rule: unknown): this;
  }

  export = TurndownService;
}
