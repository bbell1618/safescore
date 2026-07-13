import { LexisNexisPARRetrievalProvider } from "./lexisnexis";

export function getPARRetrievalProvider() {
  return new LexisNexisPARRetrievalProvider();
}

export type * from "./provider";
