/**
 * Load planets JSON and expose it as a planets array.
 *
 * @param {number} defaultIndex - default selected planet index (default: 0)
 * @returns {Promise<{planets: Array, selectedIndex: number}>} resolves with planets array and the selected index
 *
 * Usage:
 * loadPlanets(2).then(({planets, selectedIndex}) => {
 *   console.log(planets, selectedIndex);
 * });
 */
async function loadPlanets(defaultIndex = 0) {
	try {
		const res = await fetch('assets/json/planets.json');
		if (!res.ok) throw new Error(`Failed to fetch planets.json: ${res.status} ${res.statusText}`);
		const planets = await res.json();

		// ensure defaultIndex is within range
		let selectedIndex = Number(defaultIndex) || 0;
		if (selectedIndex < 0) selectedIndex = 0;
		if (selectedIndex >= planets.length) selectedIndex = planets.length - 1;

		// expose globally for simple access from other scripts
		window.planets = planets;
		window.planetsIndex = selectedIndex;

		return { planets, selectedIndex };
	} catch (err) {
		console.error('loadPlanets error:', err);
		window.planets = [];
		window.planetsIndex = 0;
		return { planets: [], selectedIndex: 0 };
	}
}

// Export on window for environments that rely on globals (optional)
window.loadPlanets = loadPlanets;

/* --------------------------
	 UI rendering & controls
	 -------------------------- */

// simple HTML escaper for safety
function _escapeHtml(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function renderPlanet(index) {
	const infoEl = document.getElementById('planet-info');
	const idxEl = document.getElementById('planet-index');
	if (!infoEl) return;

	const planets = window.planets || [];
	if (!planets.length) {
		infoEl.innerHTML = '<p>No planet data available.</p>';
		console.log('planet index: 0 / 0');
		return;
	}

	let i = typeof index === 'number' ? index : Number(window.planetsIndex) || 0;
	if (i < 0) i = 0;
	if (i >= planets.length) i = planets.length - 1;

	const p = planets[i];
	window.planetsIndex = i;

	// show basic text info (name + small_info) and prefer model view if model_path is available
	let html = '';
	html += `<h3>${_escapeHtml(p.name || 'Unnamed')}</h3>`;
	// show only the 'big_info' field as requested
	if (p.big_info) {
		if (Array.isArray(p.big_info)) {
			html += p.big_info.map(s => `<p>${_escapeHtml(s)}</p>`).join('');
		} else {
			html += `<p>${_escapeHtml(p.big_info)}</p>`;
		}
	}

	infoEl.innerHTML = html;

	console.log(`planet index: ${i} / ${planets.length - 1}`);

	// If a model_path (or model_name with model_path) is specified, initialize Three and load model
	const modelPath = p.model_path || null;
	const texturePath = p.texture || null;

	if (modelPath) {
		// initialize three once; use a very slow default rotation
		if (!window.threeApp) {
			if (typeof window.initThree !== 'function') {
				console.error('initThree not available; ensure assets/src/3dfunctions.js is loaded');
			} else {
				window.threeApp = window.initThree('#three-container', { cameraZ: 4, rotationSpeed: 0.001 });
			}
		}

		if (window.threeApp && typeof window.threeApp.loadModel === 'function') {
			// load model (catch errors so UI doesn't break). No automatic scaling is passed.
			window.threeApp.loadModel(modelPath, texturePath).then((obj) => {
				console.log('Loaded model for', p.name, obj);
				// position model and text based on index parity: even -> left text, odd -> right text
				try {
					const side = (i % 2 === 0) ? 'left' : 'right';
					// set text position class
					const infoEl = document.getElementById('planet-info');
					if (infoEl) {
						infoEl.classList.remove('info-left', 'info-right');
						infoEl.classList.add(side === 'left' ? 'info-left' : 'info-right');
					}
					// set 3D model side if supported
					if (window.threeApp && typeof window.threeApp.setModelSide === 'function') {
						window.threeApp.setModelSide(side === 'left' ? 'right' : 'left');
						// note: we invert here so that text on left -> model appears to the right side (around 66%) and vice versa
					}
				} catch (e) { console.warn('Could not set model side', e); }
			}).catch((err) => {
				console.error('Model load failed for', p.name, modelPath, err);
				// show human-readable error in the UI and keep the placeholder model visible
				const infoEl = document.getElementById('planet-info');
				if (infoEl) {
					const errText = `<p style="color:var(--error-color,#c00);">Model load failed: ${_escapeHtml(err && err.message ? err.message : String(err))}</p>`;
					const advise = `<p>Try converting the FBX to glTF (.glb) or check the model file for compatibility. I can help convert it if you want.</p>`;
					infoEl.innerHTML = (infoEl.innerHTML || '') + errText + advise;
				}
			});
		}
	} else {
		// no model for this planet: ensure placeholder sphere exists and threeApp not running
		if (window.threeApp && window.threeApp.stop) {
			window.threeApp.stop();
			window.threeApp = null;
		}
	}
}

function changeIndex(delta) {
	const planets = window.planets || [];
	if (!planets.length) return;
	let idx = Number(window.planetsIndex) || 0;
	idx += delta;
	// wrap around
	if (idx < 0) idx = planets.length - 1;
	if (idx >= planets.length) idx = 0;
	window.planetsIndex = idx;
	renderPlanet(idx);
}

document.addEventListener('DOMContentLoaded', () => {
	const prev = document.getElementById('prevBtn');
	const next = document.getElementById('nextBtn');
	if (prev) prev.addEventListener('click', () => changeIndex(-1));
	if (next) next.addEventListener('click', () => changeIndex(1));

	// Load planets and render initial
	loadPlanets().then(({ planets, selectedIndex }) => {
		renderPlanet(selectedIndex);
	});

	// Apply mask toggle: remove text-mask when scrolled to bottom so final lines are fully visible
	const infoEl = document.getElementById('planet-info');
	if (infoEl) {
		function updateMask() {
			// consider near-bottom (2% or 2px tolerance) as bottom to account for fractional pixels
			const scrollPos = infoEl.scrollTop + infoEl.clientHeight;
			const tolerance = Math.max(2, infoEl.scrollHeight * 0.02); // 2px or 2% of total height
			const atBottom = scrollPos >= (infoEl.scrollHeight - tolerance);
			if (atBottom) infoEl.classList.add('no-mask');
			else infoEl.classList.remove('no-mask');
		}
		// initial check
		updateMask();
		// listen for scroll and for content changes (simple MutationObserver)
		infoEl.addEventListener('scroll', updateMask, { passive: true });
		const mo = new MutationObserver(() => { setTimeout(updateMask, 30); });
		mo.observe(infoEl, { childList: true, subtree: true, characterData: true });
	}

	// Mini alert: suggest interacting (rotate/zoom) near the planet model
	(function setupMiniAlert(){
		const mini = document.getElementById('mini-alert');
		if (!mini) return;
		const closeBtn = mini.querySelector('.mini-alert-close');
		let hideTimeout = null;

		// start hidden so we can reveal the tip with a visible delay
		mini.classList.add('mini-alert-hidden');

		function hideMini(now = false){
			mini.classList.add('mini-alert-hidden');
			mini.setAttribute('aria-hidden', 'true');
			if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
		}

		function showMini(){
			mini.classList.remove('mini-alert-hidden');
			mini.setAttribute('aria-hidden', 'false');
			if (hideTimeout) clearTimeout(hideTimeout);
			hideTimeout = setTimeout(() => hideMini(), 6000);
		}

		// show after a short delay so it doesn't flash immediately
		setTimeout(showMini, 1200);

		// hide on user interactions focused on the 3D area
		const threeContainer = document.getElementById('three-container');
		if (threeContainer) {
			['pointerdown','wheel','touchstart'].forEach(ev => {
				threeContainer.addEventListener(ev, function onFirst(){ hideMini(); threeContainer.removeEventListener(ev, onFirst); }, { passive: true });
			});
		}

		if (closeBtn) closeBtn.addEventListener('click', hideMini);
	})();
});

