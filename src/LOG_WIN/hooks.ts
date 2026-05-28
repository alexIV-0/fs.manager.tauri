import { useEffect, useState } from 'react';
import type { StepInfo } from './types';
import { elapsed, msToElapsed, sumStepMs } from './utils';

export function useElapsed(startIso: string, endIso?: string, active = true): string {
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!active || endIso) return;
		const id = setInterval(() => setTick((v) => v + 1), 1000);
		return () => clearInterval(id);
	}, [active, endIso]);
	return elapsed(startIso, endIso);
}

export function useStepElapsed(steps: StepInfo[], active = true): string {
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!active) return;
		const id = setInterval(() => setTick((v) => v + 1), 1000);
		return () => clearInterval(id);
	}, [active]);
	return msToElapsed(sumStepMs(steps));
}
