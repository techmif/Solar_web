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
		if (idxEl) idxEl.textContent = '0 / 0';
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
	if (p.small_info) html += `<p>${_escapeHtml(p.small_info)}</p>`;

	infoEl.innerHTML = html;

	if (idxEl) idxEl.textContent = `${i} / ${planets.length - 1}`;

	// If a model_path (or model_name with model_path) is specified, initialize Three and load model
	const modelPath = p.model_path || null;
	const texturePath = p.texture || null;
	const modelScale = p.model_scale || (p.scale ? p.scale : 1);

	if (modelPath) {
		// initialize three once
		if (!window.threeApp) {
			// initThree should be provided by assets/src/3dfunctions.js
			if (typeof window.initThree !== 'function') {
				console.error('initThree not available; ensure assets/src/3dfunctions.js is loaded');
			} else {
				window.threeApp = window.initThree('#three-container', { cameraZ: 4, rotationSpeed: 0.006 });
			}
		}

		if (window.threeApp && typeof window.threeApp.loadModel === 'function') {
			// load model (catch errors so UI doesn't break)
			window.threeApp.loadModel(modelPath, texturePath, { scale: modelScale }).then((obj) => {
				console.log('Loaded model for', p.name, obj);
			}).catch((err) => {
				console.error('Model load failed for', p.name, modelPath, err);
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
});

