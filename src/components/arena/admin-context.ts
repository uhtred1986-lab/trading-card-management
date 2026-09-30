"use client";

import { createContext, useContext } from "react";

/**
 * Whether the viewer is an arena admin (issue #350). The server decides
 * (`isArenaAdmin()`), passes a boolean to `ArenaStage`, and this carries it to
 * the card faces and sheets below — it is never worked out on the client. A
 * component outside a provider is a player's: the default is false, so the
 * internals stay off anything that forgot to ask.
 */
export const AdminContext = createContext(false);

export const useArenaAdmin = () => useContext(AdminContext);
