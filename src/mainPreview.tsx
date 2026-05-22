import React from 'react';
import ReactDOM from 'react-dom/client';
import PreviewApp from './PREVIEW_WIN/PreviewApp';
import { initTauriAPI } from './Utils/tauri-api';
import { disableNativeAutofill } from './Utils/disableNativeAutofill';
import { enableTextFieldShortcuts } from './Utils/enableTextFieldShortcuts';
import '@/index.css';

async function bootstrap() {
	disableNativeAutofill();
	enableTextFieldShortcuts();
	await initTauriAPI();

	ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
		<React.StrictMode>
			<PreviewApp />
		</React.StrictMode>,
	);
}

bootstrap().catch(console.error);
