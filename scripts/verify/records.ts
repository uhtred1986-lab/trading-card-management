/**
 * The typed records a hand-staged skill needs (#1071).
 *
 * Since #1071 the engine reads a skill's use ceiling and Sparking requirement from its stored
 * `usage` and `validity` v1 records and interrupts the game when either is absent (`requireUsage`,
 * `requireValidity`); #1066 did the same for the price (`payment`). A skill drafted by the compiler
 * always carries them. A fixture that writes a `bySkill` entry by hand has to say the same thing the
 * compiler would for a skill with no ceiling and no Sparking: `...typedRecords()`. A fixture that tests a
 * ceiling or a Sparking count writes its own record instead.
 */
import { unlimitedUsage } from "../../src/lib/arena/vm/usage";
import { noSparking } from "../../src/lib/arena/vm/validity";
import { zeroSkillPrice } from "../../src/lib/arena/vm/skill-payment";

/** A fresh pair per call: a fixture may edit its own record without touching another's. */
export const typedRecords = () => ({ usage: unlimitedUsage(), validity: noSparking() });
/** The pair plus the explicit free price, for a fixture that wrote none. */
export const recordsWithPrice = () => ({ ...typedRecords(), price: zeroSkillPrice() });
