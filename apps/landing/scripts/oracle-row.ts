// The Price Oracle row shows only when the featured-run snapshot holds a real reading (truth by construction).
import type { FeaturedLike } from "./render";

const ROW = /[ \t]*<!-- oracle-row -->[\s\S]*?<!-- \/oracle-row -->\n?/;

export function withOracleRow(template: string, f: FeaturedLike): string {
  return f.oracle ? template.replace(/<!-- \/?oracle-row -->/g, "") : template.replace(ROW, "");
}
