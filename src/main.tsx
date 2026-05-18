import React from 'react';
import ReactDOM from 'react-dom/client';
import AppMain from './MAIN_WIN/AppMain';
import { initTauriAPI } from './Utils/tauri-api';
import { setupWindowAutoSave } from './Utils/windowAutoSave';
import { disableNativeAutofill } from './Utils/disableNativeAutofill';
import '@/index.css';

async function bootstrap() {
	disableNativeAutofill();
	await initTauriAPI();
	setupWindowAutoSave().catch(console.error);

	ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
		<React.StrictMode>
			<AppMain />
		</React.StrictMode>,
	);
}

bootstrap().catch(console.error);
