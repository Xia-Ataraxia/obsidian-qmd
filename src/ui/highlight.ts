export function highlightSnippet(snippet: string, queryTerms: string[]): DocumentFragment {
	const fragment = createFragment();

	if (queryTerms.length === 0) {
		fragment.appendChild(document.createTextNode(snippet));
		return fragment;
	}

	const escaped = queryTerms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	const pattern = new RegExp(`\\b(${escaped.join('|')})`, 'gi');

	let lastIndex = 0;
	for (;;) {
		const match = pattern.exec(snippet);
		if (!match) break;

		if (match.index > lastIndex) {
			fragment.appendChild(document.createTextNode(snippet.slice(lastIndex, match.index)));
		}

		const mark = createEl('mark');
		mark.textContent = match[0];
		fragment.appendChild(mark);
		lastIndex = pattern.lastIndex;
	}

	if (lastIndex < snippet.length) {
		fragment.appendChild(document.createTextNode(snippet.slice(lastIndex)));
	}

	return fragment;
}
