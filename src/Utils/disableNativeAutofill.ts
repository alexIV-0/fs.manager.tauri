const AUTOFILL_ATTRS: Record<string, string> = {
	autocomplete: 'off',
	autocorrect: 'off',
	autocapitalize: 'off',
	spellcheck: 'false',
	'data-1p-ignore': 'true',
	'data-lpignore': 'true',
	'data-form-type': 'other',
};

function applyAttrs(el: HTMLInputElement | HTMLTextAreaElement) {
	const type = (el as HTMLInputElement).type?.toLowerCase();
	if (type === 'password' || type === 'file' || type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button' || type === 'range' || type === 'color') {
		return;
	}
	for (const [name, value] of Object.entries(AUTOFILL_ATTRS)) {
		if (!el.hasAttribute(name)) el.setAttribute(name, value);
	}
}

function scan(root: ParentNode) {
	const nodes = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
	nodes.forEach(applyAttrs);
}

let started = false;

export function disableNativeAutofill() {
	if (started || typeof document === 'undefined') return;
	started = true;

	const styleId = 'disable-native-autofill-style';
	if (!document.getElementById(styleId)) {
		const style = document.createElement('style');
		style.id = styleId;
		style.textContent = `
			input::-webkit-contacts-auto-fill-button,
			input::-webkit-credentials-auto-fill-button,
			input::-webkit-caps-lock-indicator,
			input::-webkit-strong-password-auto-fill-button {
				visibility: hidden !important;
				display: none !important;
				pointer-events: none !important;
				position: absolute !important;
				right: 0 !important;
				width: 0 !important;
				height: 0 !important;
			}
		`;
		document.head.appendChild(style);
	}

	const init = () => {
		scan(document);

		const observer = new MutationObserver((mutations) => {
			for (const m of mutations) {
				m.addedNodes.forEach((node) => {
					if (!(node instanceof Element)) return;
					if (node.matches('input, textarea')) {
						applyAttrs(node as HTMLInputElement | HTMLTextAreaElement);
					}
					scan(node);
				});
			}
		});

		observer.observe(document.body, { childList: true, subtree: true });
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, { once: true });
	} else {
		init();
	}
}
