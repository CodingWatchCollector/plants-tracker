import { writable } from 'svelte/store';

interface HomeState {
	id: number;
	name: string;
}

function createHomeStore() {
	const { subscribe, set } = writable<HomeState | null>(null);

	return {
		subscribe,
		init() {
			if (typeof window === 'undefined') return;
			const raw = localStorage.getItem('home');
			if (raw) {
				try {
					set(JSON.parse(raw));
				} catch {
					localStorage.removeItem('home');
				}
			}
		},
		save(state: HomeState) {
			localStorage.setItem('home', JSON.stringify(state));
			set(state);
		},
		clear() {
			localStorage.removeItem('home');
			set(null);
		}
	};
}

export const homeStore = createHomeStore();
