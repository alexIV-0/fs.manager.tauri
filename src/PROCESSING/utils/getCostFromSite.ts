export interface SiteCostParams {
	pluginId: string;
	/** Raw response data from the external service (plugin-specific format) */
	siteResponse?: unknown;
}

// Keys checked in order — first numeric value found wins.
// Add new keys here as new services are integrated.
const COST_KEYS = [
	'cost_usd',
] as const;

export async function getCostFromSite({ siteResponse }: SiteCostParams): Promise<number | null> {
	if (!siteResponse || typeof siteResponse !== 'object') return null;
	const resp = siteResponse as Record<string, unknown>;
	for (const key of COST_KEYS) {
		const val = resp[key];
		if (typeof val === 'number' && isFinite(val)) return val;
	}
	return null;
}
