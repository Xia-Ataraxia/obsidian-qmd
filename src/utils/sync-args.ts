// qmd 2.8.3 has no scoped `update` (it always walks every collection), so only embed takes -c.
export function buildUpdateArgs(): string[] {
	return ['update'];
}

export function buildEmbedArgs(collectionName: string): string[] {
	const name = collectionName.trim();
	if (!name) throw new Error('A collection is required to build embeddings.');
	return ['embed', '-c', name];
}
