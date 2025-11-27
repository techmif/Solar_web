// Basic Three.js helper that depends on global `THREE` (UMD build)
// Exposes window.initThree(containerSelector, opts) which returns an object { renderer, scene, camera, mesh, stop }

(function () {
  function initThree(containerSelector = '#three-container', opts = {}) {
    if (typeof THREE === 'undefined') {
      console.error('THREE is not available. Make sure three.min.js is loaded before this script.');
      return null;
    }

    const container = document.querySelector(containerSelector) || document.body;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || Math.round(window.innerHeight * 0.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(width, height);
    renderer.setClearColor(opts.clearColor || 0x111111);
    // ensure correct color space for textures (r150+ uses outputColorSpace)
    try {
      if ('outputColorSpace' in renderer && THREE && THREE.SRGBColorSpace !== undefined) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      } else if ('outputEncoding' in renderer && THREE && THREE.sRGBEncoding !== undefined) {
        renderer.outputEncoding = THREE.sRGBEncoding;
      }
    } catch (e) {}

    // ensure container is empty of previous canvas
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0, opts.cameraZ || 3);
    // shared look target so zoom preserves visual offset when models are shifted
    const lookTarget = new THREE.Vector3(0, 0, 0);
    camera.lookAt(lookTarget);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 10, 7.5);
    scene.add(dir);

    // default geometry: a sphere to represent a planet (will be replaced if a model is provided)
    const geometry = new THREE.SphereGeometry(opts.radius || 0.9, 32, 32);
    const material = new THREE.MeshStandardMaterial({ color: opts.color || 0x8888ff, metalness: 0.1, roughness: 0.7 });
    const defaultMesh = new THREE.Mesh(geometry, material);
    // use a pivot group so rotation always occurs around the model's center
    let currentModel = new THREE.Group();
    currentModel.add(defaultMesh);
    scene.add(currentModel);

    let running = true;
    // dragging state for user rotation
    let isDragging = false;
    let lastPointer = { x: 0, y: 0 };
    let dragSensitivity = (opts.dragSensitivity !== undefined) ? opts.dragSensitivity : 0.005;
    // rotation speeds (very slow defaults)
    const rotationSpeed = (opts.rotationSpeed !== undefined) ? opts.rotationSpeed : 0.001;
    const rotationXSpeed = (opts.rotationXSpeed !== undefined) ? opts.rotationXSpeed : 0;
    // pointer map for multi-touch (pinch) support
    const pointers = new Map();
    let pinchStartDist = null;
    let pinchStartCamDist = null;
    let pinchStartModelScale = null;
    // zoom configuration
    let zoomEnabled = (opts.enableZoom !== undefined) ? opts.enableZoom : true;
    let minCameraZ = (opts.minCameraZ !== undefined) ? opts.minCameraZ : 0.5;
    let maxCameraZ = (opts.maxCameraZ !== undefined) ? opts.maxCameraZ : 50;
    const zoomSpeed = (opts.zoomSpeed !== undefined) ? opts.zoomSpeed : 0.0006;
    // model-scaling mode (keep center fixed) - limits
    const minModelScale = (opts.minModelScale !== undefined) ? opts.minModelScale : 0.3;
    const maxModelScale = (opts.maxModelScale !== undefined) ? opts.maxModelScale : 5.0;

    // helper: compute current model world target and a safe minimum camera distance
    function computeTargetAndSafeMin() {
      const target = new THREE.Vector3();
      let safeMin = minCameraZ;
      try {
        if (currentModel) {
          currentModel.getWorldPosition(target);
          // compute bounding sphere to figure out a safe minimum distance
          const box = new THREE.Box3().setFromObject(currentModel);
          const sphere = box.getBoundingSphere(new THREE.Sphere());
          if (sphere && sphere.radius) {
            // keep camera outside the bounding sphere plus a small margin
            safeMin = Math.max(safeMin, sphere.radius * 1.05);
          }
        } else {
          target.set(0, 0, 0);
        }
      } catch (e) {
        target.set(0, 0, 0);
      }
      return { target, safeMin };
    }

    function onResize() {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || Math.max(200, Math.round(window.innerHeight * 0.5));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }

    window.addEventListener('resize', onResize);

    function animate() {
      if (!running) return;
      if (currentModel && !isDragging) {
        currentModel.rotation.y += rotationSpeed;
        currentModel.rotation.x += rotationXSpeed;
      }
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }
    // Pointer drag handlers for rotating model
    const canvas = renderer.domElement;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';

    function onPointerDown(e) {
      // track pointer for potential pinch gestures
      try { pointers.set(e.pointerId, e); } catch (err) {}

      // if two pointers are present, initialize pinch
      if (pointers.size === 2) {
        isDragging = false;
        const pts = Array.from(pointers.values());
        pinchStartDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
        // store initial model scale so pinch will scale the model pivot (keeping center fixed)
        try { pinchStartModelScale = currentModel ? currentModel.scale.x : 1; } catch (ee) { pinchStartModelScale = 1; }
        try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (e) {}
        canvas.style.cursor = 'default';
        return;
      }

      // single-pointer: begin drag
      isDragging = true;
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
      try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (e) {}
      canvas.style.cursor = 'grabbing';
    }

    function onPointerMove(e) {
      // update stored pointer if present
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);

      // pinch handling (two pointers)
      if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
        if (pinchStartDist && pinchStartModelScale !== null && zoomEnabled) {
          // scale based on pinch ratio; keep model center fixed by scaling the model pivot
          const ratio = dist / Math.max(1, pinchStartDist);
          let newScale = pinchStartModelScale * ratio;
          newScale = Math.max(minModelScale, Math.min(maxModelScale, newScale));
          try {
            if (currentModel) currentModel.scale.set(newScale, newScale, newScale);
          } catch (ee) {
            // ignore
          }
        }
        return;
      }

      // single-pointer drag
      if (!isDragging) return;
      const dx = e.clientX - lastPointer.x;
      const dy = e.clientY - lastPointer.y;
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
      if (currentModel) {
        currentModel.rotation.y += dx * dragSensitivity;
        currentModel.rotation.x += dy * dragSensitivity;
      }
    }

    function onPointerUp(e) {
      // remove from active pointers
      try { pointers.delete(e.pointerId); } catch (err) {}
      // if pinch ended, reset pinch state
      if (pointers.size < 2) {
        pinchStartDist = null;
        pinchStartCamDist = null;
        pinchStartModelScale = null;
      }

      // if no remaining pointers, end dragging
      if (pointers.size === 0) {
        isDragging = false;
        try { canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId); } catch (e) {}
        canvas.style.cursor = 'grab';
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);

    // wheel zoom handler
    function onWheel(e) {
      if (!zoomEnabled) return;
      e.preventDefault();
      // deltaY positive -> zoom out (increase z). negative -> zoom in
      const delta = e.deltaY;
      // adjust scale multiplicatively for smooth zoom (clamped for gentler effect)
      let scale = 1 + (delta * zoomSpeed);
      // cap per-wheel-event scaling to avoid extreme jumps on large delta values
      scale = Math.max(0.9, Math.min(1.1, scale));
      // scale the model pivot so the planet's center stays fixed on-screen
      try {
        const curScale = currentModel && currentModel.scale ? currentModel.scale.x : 1;
        let newScale = curScale * scale;
        newScale = Math.max(minModelScale, Math.min(maxModelScale, newScale));
        if (currentModel) currentModel.scale.set(newScale, newScale, newScale);
      } catch (e) {
        // ignore
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false });

    requestAnimationFrame(animate);

    function stop() {
      running = false;
      try {
        window.removeEventListener('resize', onResize);
        // remove pointer listeners
        try {
          canvas.removeEventListener('pointerdown', onPointerDown);
          canvas.removeEventListener('pointermove', onPointerMove);
          canvas.removeEventListener('pointerup', onPointerUp);
          canvas.removeEventListener('pointerleave', onPointerUp);
        } catch (e) {}
        if (renderer && renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        renderer.dispose && renderer.dispose();
      } catch (e) {
        // swallow cleanup errors
      }
    }

    // model loader utility: supports FBX (if FBXLoader is available) and will apply a texture if provided
    async function loadModel(modelPath, texturePath, modelOpts = {}) {
      if (!modelPath) return Promise.reject(new Error('modelPath required'));

      // helper to dynamically load FBXLoader if not present
      async function ensureFBXLoader() {
        if (typeof THREE.FBXLoader !== 'undefined' || typeof FBXLoader !== 'undefined') return;
        const urls = [
          'https://unpkg.com/three@0.155.0/examples/js/loaders/FBXLoader.js',
          'https://cdn.jsdelivr.net/npm/three@0.155.0/examples/js/loaders/FBXLoader.js'
        ];
        for (const url of urls) {
          await new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.onload = () => { console.log('Loaded FBXLoader script from', url); resolve(true); };
            s.onerror = () => { console.warn('Failed to load FBXLoader from', url); resolve(false); };
            document.head.appendChild(s);
          });
          if (typeof THREE.FBXLoader !== 'undefined' || typeof FBXLoader !== 'undefined') return;
        }
        // final check: if still not available, give up after short delay
        await new Promise((res) => setTimeout(res, 300));
      }

      // helper to apply a texture to all mesh materials
      function applyTextureToObject(obj, texture) {
        // set texture color space in a backwards-compatible way
        try {
          if (texture) {
            if ('colorSpace' in texture && THREE && THREE.SRGBColorSpace !== undefined) texture.colorSpace = THREE.SRGBColorSpace;
            else if ('encoding' in texture && THREE && THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
          }
        } catch (e) {}

        obj.traverse((child) => {
          if (child.isMesh) {
            if (child.material) {
              child.material.map = texture;
              try {
                child.material.side = THREE.DoubleSide;
              } catch (e) {}
              child.material.needsUpdate = true;
            }
          }
        });
      }

      // remove previous model (group) from scene
      try {
        if (currentModel) scene.remove(currentModel);
      } catch (e) {}

      // load texture first (if provided). If not provided, try to auto-detect common textures in a sibling 'textures' folder.
      let tex = null;
      async function tryLoadTexture(url) {
        return new Promise((resolve, reject) => {
          new THREE.TextureLoader().load(encodeURI(url), (t) => resolve(t), undefined, (err) => reject(err));
        });
      }

      if (texturePath) {
        try {
          tex = await tryLoadTexture(texturePath);
          try { if (tex) { if ('colorSpace' in tex && THREE && THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace; else if ('encoding' in tex && THREE && THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding; } } catch (e) {}
        } catch (e) {
          console.warn('Texture load failed', texturePath, e);
          tex = null;
        }
      } else {
        // attempt to auto-detect textures in a sibling textures directory
        try {
          const parts = modelPath.split('/');
          // remove last two segments (e.g. 'source/Model.fbx') to get model root
          const base = parts.slice(0, -2).join('/');
          const texDir = base + '/textures/';
          const candidates = [
            '2_no_clouds_16k.jpeg','2_no_clouds_8k.jpg','2_no_clouds_4k.jpg','2_no_clouds.jpg',
            'fair_clouds_8k.jpeg','water_16k.png','NIGHT.jpg','eatrth.png','earth.jpg','earth.png',
            'diffuse.png','albedo.jpg','albedo.png','basecolor.jpg','basecolor.png'
          ];
          for (const name of candidates) {
            const url = texDir + name;
            try {
              const t = await tryLoadTexture(url);
              if (t) {
                try { if ('colorSpace' in t && THREE && THREE.SRGBColorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace; else if ('encoding' in t && THREE && THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding; } catch (e) {}
                tex = t;
                console.log('Auto-applied texture', url);
                break;
              }
            } catch (e) {
              // ignore missing file and continue
            }
          }
        } catch (e) {
          console.warn('Texture auto-detect failed', e);
        }
      }

      // choose loader by extension
      const ext = (modelPath.split('.').pop() || '').toLowerCase();

      if (ext === 'fbx') {
        // ensure FBXLoader is available; try to load it dynamically if missing
        if (typeof THREE.FBXLoader === 'undefined' && typeof FBXLoader === 'undefined') {
          try {
            await ensureFBXLoader();
          } catch (e) {
            console.warn('Could not dynamically load FBXLoader', e);
          }
        }
        if (typeof THREE.FBXLoader === 'undefined' && typeof FBXLoader === 'undefined') {
          return Promise.reject(new Error('FBXLoader is not available. Ensure the FBXLoader script is included.'));
        }
        const Loader = THREE.FBXLoader || FBXLoader;
        return new Promise((resolve, reject) => {
          const loader = new Loader();
            loader.load(encodeURI(modelPath), (obj) => {
              try {
                // do not apply automatic scaling by default; rely on camera-fit and user adjustments
                if (tex) applyTextureToObject(obj, tex);
                // create a pivot group so we can center the model and rotate around its geometric center
                const pivot = new THREE.Group();
                // compute bounding box for the raw object to find its center
                try {
                  const box = new THREE.Box3().setFromObject(obj);
                  const center = box.getCenter(new THREE.Vector3());
                  // shift the object's position so its center is at the pivot origin
                  obj.position.sub(center);
                } catch (e) {
                  console.warn('Could not compute bounding box to center model', e);
                }
                pivot.add(obj);
                currentModel = pivot;
                scene.add(currentModel);

                // compute camera placement based on the object's bounding box (after centering we can treat origin as center)
                try {
                  const box = new THREE.Box3().setFromObject(currentModel);
                  const size = box.getSize(new THREE.Vector3());
                  const maxDim = Math.max(size.x, size.y, size.z);
                  const fov = camera.fov * (Math.PI / 180);
                  let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
                  cameraZ *= 1.5; // add some spacing
                  camera.position.set(0, 0, cameraZ);
                  camera.lookAt(lookTarget);
                  camera.updateProjectionMatrix();
                } catch (e) {
                  console.warn('Could not compute bounding box for model (camera fit)', e);
                }

              console.log('FBX loaded:', modelPath);
              resolve(currentModel);
            } catch (e) {
              reject(e);
            }
          }, (xhr) => {
            // progress
            if (xhr && xhr.loaded && xhr.total) {
              const pct = Math.round((xhr.loaded / xhr.total) * 100);
              console.log(`FBXLoader progress: ${pct}%`);
            }
          }, (err) => {
            console.error('FBXLoader error', err);
            // Attempt fallback: same filename but .glb using GLTFLoader if available
            try {
              const glbPath = modelPath.replace(/\.fbx$/i, '.glb');
              if (typeof THREE.GLTFLoader !== 'undefined' || typeof GLTFLoader !== 'undefined') {
                const GLLoader = THREE.GLTFLoader || GLTFLoader;
                const gloader = new GLLoader();
                gloader.load(encodeURI(glbPath), (gltf) => {
                  try {
                    const obj = gltf.scene || gltf.scenes?.[0] || gltf;
                    if (tex) applyTextureToObject(obj, tex);
                    // center and pivot like above
                    try {
                      const pivot = new THREE.Group();
                      const box = new THREE.Box3().setFromObject(obj);
                      const center = box.getCenter(new THREE.Vector3());
                      obj.position.sub(center);
                      pivot.add(obj);
                      currentModel = pivot;
                      scene.add(currentModel);
                      console.log('GLB fallback loaded:', glbPath);
                      // camera fit to centered model
                      const size = box.getSize(new THREE.Vector3());
                      const maxDim = Math.max(size.x, size.y, size.z);
                      const fov = camera.fov * (Math.PI / 180);
                      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
                      cameraZ *= 1.5;
                      camera.position.set(0, 0, cameraZ);
                      camera.lookAt(lookTarget);
                      camera.updateProjectionMatrix();
                    } catch (e) { console.warn('Could not compute bounding box for GLB', e); }
                    resolve(currentModel);
                  } catch (e) { reject(e); }
                }, undefined, (gerr) => {
                  console.error('GLTFLoader fallback failed', gerr);
                  reject(err);
                });
                return;
              }
            } catch (e) {
              console.warn('GLB fallback attempt failed', e);
            }
            reject(err);
          });
        });
      }

      // fallback: try GLTFLoader if present
      if (typeof THREE.GLTFLoader !== 'undefined' || typeof GLTFLoader !== 'undefined') {
        const Loader = THREE.GLTFLoader || GLTFLoader;
          return new Promise((resolve, reject) => {
            const loader = new Loader();
            loader.load(modelPath, (gltf) => {
              const obj = gltf.scene || gltf.scenes?.[0] || gltf;
              // do not auto-scale; rely on camera-fit
              if (tex) applyTextureToObject(obj, tex);
              currentModel = obj;
              scene.add(currentModel);
              resolve(currentModel);
            }, undefined, reject);
          });
      }

      return Promise.reject(new Error('No suitable loader found for model: ' + modelPath));
    }

    // allow external positioning for left/right layout
    function setModelSide(side = 'center') {
      if (!currentModel) return;
      try {
        const box = new THREE.Box3().setFromObject(currentModel);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const fov = camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5;
        // reduce the offset so the planet is closer to the viewer center
        const offset = maxDim * 0.6; // half the previous offset
        let x = 0;
        if (side === 'right') x = Math.abs(offset);
        else if (side === 'left') x = -Math.abs(offset);
        // position model pivot (move model away from origin)
        currentModel.position.set(x, 0, 0);
        // keep camera centered at origin so shifted model appears to left/right
        camera.position.set(0, 0, cameraZ);
        camera.lookAt(lookTarget);
        camera.updateProjectionMatrix();
      } catch (e) {
        console.warn('setModelSide failed', e);
      }
    }

    // zoom controls API
    function setZoomEnabled(val) { zoomEnabled = !!val; }
    function setZoomLimits(min, max) {
      if (typeof min === 'number') minCameraZ = min;
      if (typeof max === 'number') maxCameraZ = max;
      // clamp current camera z within new limits
      camera.position.z = Math.max(minCameraZ, Math.min(maxCameraZ, camera.position.z));
      camera.updateProjectionMatrix();
    }
    function getZoom() { return camera.position.z; }

    return { renderer, scene, camera, mesh: currentModel, loadModel, stop, setModelSide, setZoomEnabled, setZoomLimits, getZoom };
  }

  // expose helper
  window.initThree = initThree;
})();
