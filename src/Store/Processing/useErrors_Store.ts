import { create } from 'zustand';

interface ErrorsState {
	errors: any[]; // можно заменить на конкретный тип ошибки
	addErrorsState: (error: any[]) => void;
	clearErrorsState: () => void;
}

export const useErrors_Store = create<ErrorsState>((set) => ({
	errors: [],

	addErrorsState: (error) =>
		set((state) => ({
			errors: [...state.errors, ...error],
		})),

	clearErrorsState: () =>
		set(() => ({
			errors: [],
		})),
}));
