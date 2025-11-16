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

	// Build a simple list of properties
	let html = '';
	html += `<h3>${_escapeHtml(p.name || 'Unnamed')}</h3>`;
	html += '<ul>';
	for (const key of Object.keys(p)) {
		const val = p[key];
		// show objects/arrays as JSON
		const display = (typeof val === 'object') ? _escapeHtml(JSON.stringify(val)) : _escapeHtml(String(val));
		html += `<li><strong>${_escapeHtml(key)}:</strong> ${display}</li>`;
	}
	html += '</ul>';

	infoEl.innerHTML = html;
	if (idxEl) idxEl.textContent = `${i} / ${planets.length - 1}`;
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

