export function computeNextWateringDate(from: string, intervalDays: number): string {
	const date = new Date(from);
	date.setDate(date.getDate() + intervalDays);
	// normalize to date only, no time component
	return date.toISOString().split('T')[0];
}
