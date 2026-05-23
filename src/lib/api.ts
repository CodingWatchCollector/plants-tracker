export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
	return fetch(url, {
		credentials: 'same-origin', // ensures cookies are sent
		headers: {
			'Content-Type': 'application/json',
			...options.headers
		},
		...options
	});
}
