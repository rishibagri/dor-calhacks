// Loads the generated SpacetimeDB bindings at runtime without type-checking them under NodeNext
// (they are compiled separately by tsconfig.bindings.json; see scripts/fix-bindings-imports.mjs).
// The worker only needs DbConnection.builder(), which it treats as a LooseBuilder.
export async function loadBindings(): Promise<Record<string, unknown>> {
  const specifier = './module_bindings/index.js';
  return (await import(specifier)) as Record<string, unknown>;
}
