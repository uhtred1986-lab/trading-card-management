"use client";

import { RuleBuilder, type RuleBuilderProps } from "./RuleBuilder";
import { teachTabs } from "./TeachPanels";
import { TryItPanel } from "./tryit/TryItPanel";

/**
 * The block builder with everything mounted in it: #473's "In my words" and
 * "Like a card" tabs beside Blocks, and #470's Try it under the blocks. A
 * client component of its own because the builder's page is a server
 * component, and both are render functions, which cannot cross from the
 * server to the client.
 */
export function FullRuleBuilder(props: Omit<RuleBuilderProps, "teachTabs" | "tryIt">) {
  return <RuleBuilder {...props} teachTabs={teachTabs} tryIt={(p) => <TryItPanel {...p} />} />;
}
